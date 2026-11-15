// Every feature module. To add one: create a file exporting a VersobsModule and list it here.
import type { VersobsModule } from "../core/module";
import { exportModule } from "./export";
import { flashcardsModule } from "./flashcards";
import { organizeModule } from "./organize";
import { qualcodeModule } from "./qualcode";
import { researchModule } from "./research";
import { slidesModule } from "./slides";
import { summarizeModule } from "./summarize";
import { systemModule } from "./system";
import { telegramModule } from "./telegram";
import { toolRunnerModule } from "./tool-runner";
import { transcribeModule } from "./transcribe";
import { translateModule } from "./translate";

export const MODULES: VersobsModule[] = [
	transcribeModule,
	summarizeModule,
	translateModule,
	exportModule,
	flashcardsModule,
	slidesModule,
	qualcodeModule,
	researchModule,
	telegramModule,
	organizeModule,
	toolRunnerModule,
	systemModule,
];
