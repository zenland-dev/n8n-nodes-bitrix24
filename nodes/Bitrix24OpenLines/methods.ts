import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import { portalKey } from '../../shared/transport';
import { offsetList } from '../../shared/offset';

export const loadOptions = {
	/** Open channels the webhook user can see, shared for a couple of minutes per portal. */
	async getOpenLines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const lines = await cached(
			`${await portalKey.call(this)}|openlines|lines`,
			async () =>
				await offsetList.call(this, 'imopenlines.config.list.get', { PARAMS: { select: ['ID', 'LINE_NAME', 'ACTIVE'], order: { LINE_NAME: 'asc' } } }, {
					pageSize: 200,
					itemIndex: 0,
					offsetKey: 'offset',
					limitKey: 'limit',
					nestedIn: 'PARAMS',
				}),
			CONFIG_TTL_MS,
		);
		return (lines as IDataObject[])
			.map((line) => {
				const id = Number(line.ID);
				const name = String(line.LINE_NAME ?? id);
				return { name: line.ACTIVE === 'N' ? `${name} (inactive)` : name, value: id, description: `Open line ${id}` };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},
};
