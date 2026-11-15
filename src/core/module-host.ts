// Loads enabled modules and turns them on/off at runtime without reloading the plugin.
import { ModuleContext, type VersobsModule } from "./module";
import type { Versobs } from "./versobs";

export class ModuleHost {
	private contexts = new Map<string, ModuleContext>();

	constructor(
		private core: Versobs,
		readonly modules: VersobsModule[],
	) {}

	isEnabled(module: VersobsModule): boolean {
		return this.core.settings.modules[module.id] ?? module.defaultEnabled ?? true;
	}

	context(id: string): ModuleContext | undefined {
		return this.contexts.get(id);
	}

	/** A context for settings even when the module is off (settings are still editable). */
	settingsContext(module: VersobsModule): ModuleContext {
		return this.contexts.get(module.id) ?? new ModuleContext(this.core, module);
	}

	loadAll(): void {
		for (const module of this.modules) if (this.isEnabled(module)) this.start(module);
	}

	unloadAll(): void {
		for (const id of [...this.contexts.keys()]) this.stop(id);
	}

	async setEnabled(module: VersobsModule, enabled: boolean): Promise<void> {
		this.core.settings.modules[module.id] = enabled;
		await this.core.save();
		if (enabled) this.start(module);
		else this.stop(module.id);
	}

	private start(module: VersobsModule): void {
		if (this.contexts.has(module.id)) return;
		const ctx = new ModuleContext(this.core, module);
		this.core.plugin.addChild(ctx);
		try {
			module.load(ctx);
			this.contexts.set(module.id, ctx);
		} catch (err) {
			console.error(`[versobs] module ${module.id} failed to load`, err);
			this.core.plugin.removeChild(ctx);
		}
	}

	private stop(id: string): void {
		const ctx = this.contexts.get(id);
		if (!ctx) return;
		this.contexts.delete(id);
		this.core.plugin.removeChild(ctx);
	}
}
