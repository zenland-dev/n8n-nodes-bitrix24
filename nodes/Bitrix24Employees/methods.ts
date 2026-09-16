import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import { extractRows } from '../../shared/list';
import { bitrix24Request, portalKey } from '../../shared/transport';

export const loadOptions = {
	/** The departments of the company structure, for pickers that take a department. */
	async getDepartments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const portal = await portalKey.call(this);
		return await cached(
			`employees:departments:${portal}`,
			async () => {
				const body = await bitrix24Request.call(this, 'department.get', { sort: 'NAME', order: 'ASC' });
				return extractRows(body.result)
					.map((row: IDataObject) => ({ name: String(row.NAME ?? row.ID), value: Number(row.ID) }))
					.filter((option) => Number.isInteger(option.value) && option.value > 0)
					.sort((a, b) => a.name.localeCompare(b.name));
			},
			CONFIG_TTL_MS,
		);
	},
};
