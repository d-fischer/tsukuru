export interface ProjectMode {
	checkRequirements?: () => void | Promise<void>;
	checkRequirementsAfterInit?: () => void | Promise<void>;
	cleanAndInitCommonJs: () => void | Promise<void>;
	checkTsErrors: () => void;
	emitCommonJs: (useTransformers: boolean) => void;

	cleanAndInitEsm: () => void | Promise<void>;
	emitEsm: () => void;
}
