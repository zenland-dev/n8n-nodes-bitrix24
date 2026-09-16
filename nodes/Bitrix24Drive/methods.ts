import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { bitrix24Request } from '../../shared/transport';

const LEVEL_NAMES: Record<string, string> = {
	disk_access_read: 'Read',
	disk_access_add: 'Add',
	disk_access_edit: 'Edit',
	disk_access_full: 'Full Access',
};

export const loadOptions = {
	/** Access levels for rights on a new file or folder. Their IDs differ from portal to portal. */
	async getAccessLevels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const body = await bitrix24Request.call(this, 'disk.rights.getTasks', {});
		const levels = Array.isArray(body.result) ? (body.result as IDataObject[]) : [];
		return levels
			.map((level) => {
				const code = String(level.NAME ?? '');
				return { name: LEVEL_NAMES[code] ?? String(level.TITLE ?? code), value: Number(level.ID) };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},
};
