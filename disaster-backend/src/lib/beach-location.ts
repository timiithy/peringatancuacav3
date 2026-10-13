import { BEACH_REGISTRY, type BeachRegistryEntry } from "../types";

export type Coordinates = {
	latitude: number;
	longitude: number;
};

function toRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function distanceInMeters(a: Coordinates, b: Coordinates): number {
	const earthRadiusMeters = 6_371_000;
	const deltaLatitude = toRadians(b.latitude - a.latitude);
	const deltaLongitude = toRadians(b.longitude - a.longitude);
	const latitudeA = toRadians(a.latitude);
	const latitudeB = toRadians(b.latitude);
	const haversine =
		Math.sin(deltaLatitude / 2) ** 2
		+ Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
	return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function isValidCoordinates(latitude: number, longitude: number): boolean {
	return Number.isFinite(latitude)
		&& Number.isFinite(longitude)
		&& latitude >= -90
		&& latitude <= 90
		&& longitude >= -180
		&& longitude <= 180;
}

export function findNearestBeach(latitude: number, longitude: number): {
	beach: BeachRegistryEntry;
	distanceMeters: number;
} | null {
	if (!isValidCoordinates(latitude, longitude)) return null;

	const current = { latitude, longitude };
	let nearest: { beach: BeachRegistryEntry; distanceMeters: number } | null = null;
	for (const beach of BEACH_REGISTRY) {
		const distanceMeters = distanceInMeters(current, beach);
		if (!nearest || distanceMeters < nearest.distanceMeters) {
			nearest = { beach, distanceMeters };
		}
	}
	return nearest;
}