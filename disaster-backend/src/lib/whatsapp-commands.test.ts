import { expect, test } from "bun:test";
import { parseLaporCommand } from "./whatsapp-commands";

test.each(Array.from({ length: 17 }, (_, i) => i + 1))(
	"WhatsApp accepts explicit Wn-%i without adding signs from prose", (number) => {
		expect(parseLaporCommand(`!lapor lampuuk WN-${number} awan gelap waktu=sekarang`)).toEqual({
			ok: true, beachLocation: "pantai_lampuuk", likCodes: [`Wn-${number}`],
		});
	},
);

test("mixed explicit codes deduplicate and preserve provisional observations", () => {
	expect(parseLaporCommand("!lapor samas WN-4 wn-16 WN-16")).toEqual({
		ok: true, beachLocation: "pantai_samas", likCodes: ["Wn-4", "Wn-16"],
	});
	expect(parseLaporCommand("!lapor samas WN-18")).toEqual({ ok: false, missing: "signs" });
});

test.each([
	["cerah tanpa awan saat angin barat", "Wn-10"],
	["suara gemuruh sekali", "Wn-11"],
	["bintang berkelap-kelip saat angin barat", "Wn-12"],
	["bintang dekat bulan", "Wn-14"],
	["kecoa beterbangan", "Wn-15"],
	["bulan di antara capit Bintang Kala", "Wn-16"],
	["paus muncul ke permukaan dan mengibaskan ekor", "Wn-17"],
])("recognizes Table B provisional observation: %s", (description, code) => {
	expect(parseLaporCommand(`!lapor lampuuk ${description}`)).toEqual({
		ok: true, beachLocation: "pantai_lampuuk", likCodes: [code],
	});
});

test("existing wave and wind commands still work", () => {
	expect(parseLaporCommand("!lapor lampuuk ombak besar angin kencang")).toEqual({
		ok: true, beachLocation: "pantai_lampuuk", likCodes: ["Wn-4", "Wn-7"],
	});
});
