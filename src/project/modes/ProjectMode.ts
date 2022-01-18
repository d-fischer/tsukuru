export interface ProjectMode {
	checkRequirements: () => void | Promise<void>;
	initCommonJs: () => void;
	checkTsErrors: () => void;
	cleanCommonJs: () => void | Promise<void>;
	emitCommonJs: (useTransformers: boolean) => void;

	initEsm: () => void;
	cleanEsm: () => void | Promise<void>;
	emitEsm: () => void;
}
