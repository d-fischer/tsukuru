export interface ProjectMode {
	init?: () => void | Promise<void>;
	checkRequirements?: () => void | Promise<void>;
	checkRequirementsAfterInit?: () => void | Promise<void>;
	cleanAndInitCommonJs: () => void | Promise<void>;
	checkTsErrors: () => void;
	emitCommonJs: (useTransformers: boolean) => void;

	cleanAndInitEsm: () => void | Promise<void>;
	emitEsm: () => void;
	renameEsmOutputs: () => void | Promise<void>;
}
