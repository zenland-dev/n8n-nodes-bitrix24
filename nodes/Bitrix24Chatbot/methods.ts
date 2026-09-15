import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { listBots } from './resources/bot';

export const loadOptions = {
	/**
	 * Bots of the Bot Token in the credential. Not memoised like other dropdowns: the
	 * list depends on the token, and a bot registered a moment ago should show up.
	 */
	async getBots(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const bots = await listBots.call(this, undefined, Infinity);
		return bots
			.map((bot) => {
				const profile = (bot.profile ?? {}) as IDataObject;
				const name = String(profile.name ?? '').trim() || String(bot.code ?? bot.id);
				return { name: `${name} (${String(bot.code ?? '')})`, value: Number(bot.id), description: `Bot ${String(bot.id)}, type ${String(bot.type ?? 'bot')}, events by ${String(bot.eventMode ?? 'fetch')}` };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},
};
