// The unit of extension: a module adds commands, menus and settings for one area (transcribe, export, ...).
// Everything a module registers goes through its ModuleContext, so disabling the module removes it all.
import {
	type Command,
	Component,
	type Editor,
	type MarkdownFileInfo,
	type MarkdownView,
	type Menu,
	type SettingDefinitionItem,
	type TAbstractFile,
} from "obsidian";
import type { MessageKey } from "../i18n";
import type { Versobs } from "./versobs";

export interface VersobsModule {
	/** Stable id; used for command ids and settings namespace. */
	id: string;
	name: MessageKey;
	description: MessageKey;
	/** Versline bridge tools this module needs (shown in settings; checked before running). */
	tools?: string[];
	defaultEnabled?: boolean;
	defaults?: Record<string, unknown>;
	/** Declarative settings for this module (keys from ctx.key()). */
	settings?(ctx: ModuleContext): SettingDefinitionItem[];
	load(ctx: ModuleContext): void;
}

export class ModuleContext extends Component {
	private commandIds: string[] = [];

	constructor(
		public readonly core: Versobs,
		public readonly module: VersobsModule,
	) {
		super();
	}

	get app() {
		return this.core.app;
	}

	addCommand(command: Command): void {
		const id = `${this.module.id}-${command.id}`;
		this.core.plugin.addCommand({ ...command, id });
		this.commandIds.push(id);
	}

	onFileMenu(callback: (menu: Menu, file: TAbstractFile, source: string) => void): void {
		this.registerEvent(this.app.workspace.on("file-menu", callback));
	}

	onFilesMenu(callback: (menu: Menu, files: TAbstractFile[], source: string) => void): void {
		this.registerEvent(this.app.workspace.on("files-menu", callback));
	}

	onEditorMenu(callback: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => void): void {
		this.registerEvent(this.app.workspace.on("editor-menu", callback));
	}

	/** Settings key for declarative controls, e.g. ctx.key("folder") -> "moduleSettings.telegram.folder". */
	key(name: string): string {
		return `moduleSettings.${this.module.id}.${name}`;
	}

	get<T>(name: string): T {
		const stored = this.core.settings.moduleSettings[this.module.id]?.[name];
		return (stored !== undefined ? stored : this.module.defaults?.[name]) as T;
	}

	async set(name: string, value: unknown): Promise<void> {
		const bucket = (this.core.settings.moduleSettings[this.module.id] ??= {});
		bucket[name] = value;
		await this.core.save();
	}

	override onunload(): void {
		for (const id of this.commandIds) this.core.plugin.removeCommand(id);
		this.commandIds = [];
	}
}
