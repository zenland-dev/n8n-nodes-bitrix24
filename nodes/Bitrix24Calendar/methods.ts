import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import { extractRows } from '../../shared/list';
import { bitrix24Request, portalKey } from '../../shared/transport';
import { COMPANY_TYPE, GROUP_TYPE, webhookUserId } from './shared/helpers';

function named(rows: IDataObject[]): INodePropertyOptions[] {
	return rows
		.map((row) => ({ name: String(row.NAME ?? row.ID), value: Number(row.ID) }))
		.filter((option) => Number.isInteger(option.value) && option.value > 0)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const loadOptions = {
	/** The calendars of whichever owner the parameters above name. */
	async getSections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const type = String(this.getCurrentNodeParameter('calendarType') ?? 'user');
		const chosen = Number(this.getCurrentNodeParameter('ownerId') ?? 0) || 0;

		let ownerId = chosen;
		if (type === COMPANY_TYPE) ownerId = 0;
		// A group calendar has no default owner, so the list stays empty until one is named.
		else if (chosen <= 0 && type === GROUP_TYPE) return [];
		else if (chosen <= 0) ownerId = await webhookUserId(this);

		const portal = await portalKey.call(this);
		return await cached(
			`calendar:sections:${portal}:${type}:${ownerId}`,
			async () => {
				const body = await bitrix24Request.call(this, 'calendar.section.get', { type, ownerId });
				return named(extractRows(body.result));
			},
			CONFIG_TTL_MS,
		);
	},

	/** Rooms, cars and the rest of what clients book. */
	async getResources(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const portal = await portalKey.call(this);
		return await cached(
			`calendar:resources:${portal}`,
			async () => {
				const body = await bitrix24Request.call(this, 'calendar.resource.list', {});
				return named(extractRows(body.result));
			},
			CONFIG_TTL_MS,
		);
	},
};
