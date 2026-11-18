export const ALLOWED_BEACH_LOCATIONS = [
	"pantai_lampuuk",
	"pantai_lhoknga",
	"pantai_ulee_lheue",
	"pantai_depok",
	"pantai_samas",
] as const;

export type BeachLocation = (typeof ALLOWED_BEACH_LOCATIONS)[number];

export type BeachRegistryEntry = {
	slug: BeachLocation;
	name: string;
	latitude: number;
	longitude: number;
};

export const BEACH_REGISTRY: readonly BeachRegistryEntry[] = [
	{ slug: "pantai_lampuuk", name: "Pantai Lampuuk", latitude: 5.4833, longitude: 95.2333 },
	{ slug: "pantai_lhoknga", name: "Pantai Lhoknga", latitude: 5.4667, longitude: 95.2333 },
	{ slug: "pantai_ulee_lheue", name: "Pantai Ulee Lheue", latitude: 5.5583, longitude: 95.3083 },
	{ slug: "pantai_depok", name: "Pantai Depok", latitude: -8.0167, longitude: 110.3167 },
	{ slug: "pantai_samas", name: "Pantai Samas", latitude: -8.025, longitude: 110.3 },
];

export type PredictionInput = {
	lik_codes: string[];
	beach_location?: BeachLocation;
	latitude?: number;
	longitude?: number;
	location_accuracy_m?: number;
	location_source?: "device" | "manual";
	clientReportId?: string;
	reporterBrowserId?: string;
	createdAtClient?: number;
	observedAt?: number;
	_experimentId?: string;
	is_active_warning?: boolean;
	active_warning?: string[];
	_channel?: string;
};

export type ContributionItem = {
	factor: string;
	label_id: string;
	label_en: string;
	category: "natural_sign" | "community";
	weight: number;
	direction: "increases_risk" | "neutral";
	detail_id: string;
	detail_en: string;
};

export type CommunityProfileFactor = {
	key: string;
	label_id: string;
	label_en: string;
	value: number;
	status: string;
	detail_id: string;
	detail_en: string;
};

export type ExplanationData = {
	summary_id: string;
	summary_en: string;
	contributions: ContributionItem[];
	community_profile: {
		beach: string;
		overall: string;
		factors: CommunityProfileFactor[];
	};
};

export type MlResult = {
	inference_status?: "evaluated" | "insufficient_evidence";
	unranked_lik_codes?: string[];
	active_warning: string[];
	sign_description: string;
	community_characteristics: string;
	action_recommendation: string;
	triggered_lik_codes?: string[];
	explanation?: ExplanationData;
};

export type AckInput = {
	alertId: string;
	transport: "SSE" | "WS" | "PUSH";
	receivedAtClient: number;
	serverTimestamp: number;
	ackStage?: "DELIVERED" | "OPENED";
	// Optional fields you can add later:
	clientId?: string;
	// userId?: string;
};
