# Indicator media approval proposal

Open index.html in a browser for all 17 previews, notes, and source/license links. The approved images are applied to the report page. Wn-16 now uses a simplified illustration.

Measured displayed asset total: 143.2 KiB. Source thumbnails in references are research material, not the delivery bundle.

| Code | Description | Proposal | Preview size | Source |
|---|---|---|---:|---|
| Wn-1 | Awan tampak turun dan menggumpal hingga tiga kali | motion | 1.7 KiB | [Source](https://commons.wikimedia.org/wiki/File:Clouds,_cloudscape_over_Lombok_Strait,_West_Nusa_Tenggara,_Indonesia.jpg) |
| Wn-2 | Beberapa gumpalan awan tampak saling mendekat atau menyatu | motion | 1.2 KiB | [Source](https://commons.wikimedia.org/wiki/File:Clouds,_cloudscape_over_Lombok_Strait,_West_Nusa_Tenggara,_Indonesia.jpg) |
| Wn-3 | Petir terlihat di satu sisi langit atau bergantian di dua sisi | photo | 14.2 KiB | [Source](https://commons.wikimedia.org/wiki/File:Lightning_storm_over_ocean.jpg) |
| Wn-4 | Ombak berubah dari kecil dan rapat menjadi besar dan berdekatan | diagram | 1.3 KiB | Original SVG |
| Wn-5 | Lumba-lumba mendekati perahu, seolah-olah menuntun arah | photo | 34.4 KiB | [Source](https://commons.wikimedia.org/wiki/File:Short-beaked_Common_Dolphin_(Delphinus_delphis)_(14825276609).jpg) |
| Wn-6 | Burung camar terbang cepat sambil bersuara keras | photo | 6.2 KiB | [Source](https://commons.wikimedia.org/wiki/File:Seagull_flying_over_the_beach_with_motion.jpg) |
| Wn-7 | Sedang terjadi pergantian musim angin barat ke angin timur | diagram | 1.3 KiB | Original SVG |
| Wn-8 | Langit tertutup awan, tetapi tidak terlalu gelap | photo | 6.1 KiB | [Source](https://commons.wikimedia.org/wiki/File:Shaheed_Island,_Andaman_Sea,_Overcast_sky.jpg) |
| Wn-9 | Hujan turun atau awan tebal menutupi langit saat musim angin timur | photo | 12.0 KiB | [Source](https://commons.wikimedia.org/wiki/File:A_rain_over_the_sea_-_panoramio.jpg) |
| Wn-10 | Langit cerah tanpa awan saat musim angin barat | photo | 41.8 KiB | [Source](https://commons.wikimedia.org/wiki/File:Bright_Blue_Sky.jpg) |
| Wn-11 | Terdengar suara gemuruh keras, sekali atau hingga tujuh kali | motion | 1.1 KiB | Original SVG |
| Wn-12 | Banyak bintang tampak berkelap-kelip saat musim angin barat | motion | 3.1 KiB | [Source](https://commons.wikimedia.org/wiki/File:Stars_01_(MK).jpg) |
| Wn-13 | Bintang tidak terlihat pada malam hari saat musim angin timur | diagram | 0.8 KiB | [Source](https://commons.wikimedia.org/wiki/File:Cloudy_night.jpg) |
| Wn-14 | Bintang tampak dekat atau sejajar dengan bulan, termasuk di dalam lingkaran cahaya bulan | photo | 1.5 KiB | [Source](https://commons.wikimedia.org/wiki/File:Moon_HALO_Effect.jpg) |
| Wn-15 | Kecoa beterbangan di dalam perahu | motion | 2.4 KiB | [Source](https://commons.wikimedia.org/wiki/File:Periplaneta_australasiae_wings.jpg) |
| Wn-16 | Bulan terlihat di antara dua capit rasi bintang Kalajengking (Bintang Kala) | diagram | 2.6 KiB | [Source](https://commons.wikimedia.org/wiki/File:Scorpius_IAU.svg) |
| Wn-17 | Paus muncul ke permukaan dan mengibaskan ekornya | photo | 11.4 KiB | [Source](https://commons.wikimedia.org/wiki/File:Whale_Tail_Slap_129.jpg) |

## Approval

- User approved the visual set, requesting a clearer illustration for the star arrangement.
- Wn-16: replaced the chart with a simplified Moon-between-claws diagram based on the approved arrangement.
- Wn-17: the approved still is used. The optional video is a reference only.

## Delivery targets

Photos: WebP, maximum 640 px wide, target <=60 KiB. Diagrams: SVG target <=10 KiB. Optional real motion: 2–4 second animated WebP target <=200 KiB, measured after encoding. Mount images only for opened categories; use stills when reduced motion is requested. Text remains necessary for sounds, repetition, seasons, and context not visible in a photo.

Maintain credits and compatible licenses for adapted CC BY-SA media. The preview only resizes/encodes photos, preserving their full compositions. No hotlinked production assets.

## Reproduction

Research: python artifacts/indicator-media-proposal/research.py --download (public network required). Preview: node artifacts/indicator-media-proposal/build-preview.mjs (uses the existing frontend sharp dependency).
