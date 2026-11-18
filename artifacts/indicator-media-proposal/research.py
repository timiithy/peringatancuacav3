"""Collect public Commons metadata for a review proposal; never edits the app."""
import concurrent.futures
import html
import json
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
API = 'https://commons.wikimedia.org/w/api.php'
QUERIES = {
    'clouds': 'intitle:"Clouds, cloudscape over Lombok Strait"',
    'cloud-motion': 'intitle:clouds filetype:video',
    'lightning': 'intitle:"Lightning storm over ocean.jpg"',
    'waves': 'intitle:waves filetype:video',
    'dolphin': 'intitle:dolphin intitle:bow',
    'gull': 'intitle:"Seagull flying.jpg"',
    'overcast': 'intitle:overcast intitle:sea',
    'rain': 'intitle:"A rain over the sea"',
    'clear': 'intitle:"clear sky" intitle:sea',
    'stars': 'intitle:"starry sky" intitle:sea',
    'night': 'intitle:"cloudy night"',
    'halo': 'intitle:"Moon HALO Effect.jpg"',
    'cockroach': 'cockroach flying',
    'scorpius': 'intitle:"Scorpius IAU"',
    'whale': 'intitle:"Whale Tail Slap"',
}
TITLES = {
    'clouds': 'Clouds, cloudscape over Lombok Strait, West Nusa Tenggara, Indonesia.jpg',
    'lightning': 'Lightning storm over ocean.jpg',
    'dolphin': 'Burrunan Dolphin bow riding 2011.jpg',
    'gull': 'Seagull flying.jpg',
    'overcast': 'Shaheed Island, Andaman Sea, Overcast sky.jpg',
    'rain': 'A rain over the sea - panoramio.jpg',
    'clear': 'Clear sky in İstanbul.jpg',
    'stars': 'Stars 01 (MK).jpg',
    'halo': 'Moon HALO Effect.jpg',
    'scorpius': 'Scorpius IAU.svg',
    'whale': 'Whale Tail Slap 129.jpg',
    'whale-motion': '032 Humpback whale lobtailing in slow motion Video by Giles Laurent.webm',
    'waves': 'Waves crashing in a rock slit in Saint-Malo.webm',
    'dolphin-front': 'Common Bottlenose Dolphin (Tursiops truncatus) Catalina swimming in front of boat.jpg',
    'dolphin-common': 'Short-beaked Common Dolphin (Delphinus delphis) (14825276609).jpg',
    'clear-blue': 'Bright Blue Sky.jpg',
    'sea-blue': 'The sea is clear and the sky is blue!.jpg',
    'night': 'Cloudy night.jpg',
    'cockroach': 'Periplaneta australasiae wings.jpg',
    'gull-motion': 'Seagull flying over the beach with motion.jpg',
}

def request(params):
    url = API + '?' + urllib.parse.urlencode({'format': 'json', **params})
    req = urllib.request.Request(url, headers={'User-Agent': 'IndicatorMediaProposal/1.0 (public educational image research)'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def plain(value):
    return html.unescape(re.sub('<[^>]+>', '', str(value)))

def search(item):
    key, query = item
    result = request({'action':'query','generator':'search','gsrsearch':query,'gsrnamespace':6,'gsrlimit':3,
                      'prop':'imageinfo','iiprop':'url|size|extmetadata','iiurlwidth':640})
    candidates = []
    for page in result.get('query',{}).get('pages',{}).values():
        info = page.get('imageinfo',[{}])[0]
        meta = info.get('extmetadata',{})
        value = lambda name: plain(meta.get(name,{}).get('value',''))
        candidates.append({'title':page['title'],'source':info.get('descriptionurl'),
            'preview': info.get('thumburl',info.get('url')), 'original':info.get('url'),
            'width':info.get('width'),'height':info.get('height'),'originalBytes':info.get('size'),
            'author':value('Artist'),'license':value('LicenseShortName'),'licenseUrl':value('LicenseUrl'),
            'description':value('ImageDescription'),'credit':value('Credit'),'restrictions':value('Restrictions')})
    return key, candidates

if __name__ == '__main__':
    result = request({'action':'query','titles':'|'.join('File:'+t for t in TITLES.values()),
                      'prop':'imageinfo','iiprop':'url|size|extmetadata','iiurlwidth':640})
    pages = {p['title']: p for p in result.get('query',{}).get('pages',{}).values()}
    prior = json.loads((HERE/'candidates.json').read_text(encoding='utf-8')) if (HERE/'candidates.json').exists() else {}
    records = {}
    for key, title in TITLES.items():
        page = pages.get('File:'+title,{})
        if not page.get('imageinfo'):
            records[key] = []
            continue
        info = page['imageinfo'][0]
        meta = info.get('extmetadata',{})
        value = lambda name: plain(meta.get(name,{}).get('value',''))
        records[key] = [{'title':page['title'],'source':info.get('descriptionurl'),
            'preview': info.get('thumburl',info.get('url')), 'original':info.get('url'),
            'width':info.get('width'),'height':info.get('height'),'originalBytes':info.get('size'),
            'author':value('Artist'),'license':value('LicenseShortName'),'licenseUrl':value('LicenseUrl'),
            'description':value('ImageDescription'),'credit':value('Credit'),'restrictions':value('Restrictions')}]
        if prior.get(key):
            for field in ('localPreview','previewBytes'):
                if field in prior[key][0]:
                    records[key][0][field] = prior[key][0][field]
    (HERE/'candidates.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    for key, candidates in records.items():
        print(key + ': ' + json.dumps([{k:v for k,v in c.items() if k in ('title','license','originalBytes','description')} for c in candidates],ensure_ascii=True))
    if '--download' in sys.argv:
        (HERE/'references').mkdir(exist_ok=True)
        for key, candidates in records.items():
            if not candidates:
                continue
            candidate = candidates[0]
            if candidate.get('localPreview') and (HERE/candidate['localPreview']).exists():
                continue
            url = candidate['preview']
            req = urllib.request.Request(url, headers={'User-Agent':'IndicatorMediaProposal/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    data = response.read(3_000_001)
                    content_type = response.headers.get('Content-Type','')
                if len(data) > 3_000_000 or not content_type.startswith('image/'):
                    print('SKIPPED non-thumbnail: '+key)
                    continue
                ext = '.png' if 'png' in content_type else '.jpg'
                local = 'references/'+key+ext
                (HERE/local).write_bytes(data)
                candidate['localPreview'] = local
                candidate['previewBytes'] = len(data)
                print('DOWNLOADED '+key+' '+str(len(data))+' bytes')
            except Exception as error:
                print('DOWNLOAD FAILED '+key+': '+str(error))
        (HERE/'candidates.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
