import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import { listAll } from '../../shared/list';
import { portalKey } from '../../shared/transport';

/** Workgroups, projects and scrums the webhook user can see, shared for a couple of minutes per portal. */
async function workgroups(ctx: ILoadOptionsFunctions): Promise<IDataObject[]> {
	return await cached(
		`${await portalKey.call(ctx)}|tasks|workgroups`,
		async () =>
			await listAll.call(ctx, 'socialnetwork.api.workgroup.list', { select: ['ID', 'NAME', 'TYPE', 'CLOSED'], order: { NAME: 'ASC' } }, { itemsKey: 'workgroups' }),
		CONFIG_TTL_MS,
	);
}

const TYPE_LABELS: Record<string, string> = { project: 'Project', scrum: 'Scrum', collab: 'Collab', group: 'Group' };

function toOptions(groups: IDataObject[]): INodePropertyOptions[] {
	return groups
		.map((g) => {
			const id = Number(g.id ?? g.ID);
			const name = String(g.name ?? g.NAME ?? id);
			const type = TYPE_LABELS[String(g.type ?? g.TYPE ?? '').toLowerCase()] ?? 'Group';
			const archived = String(g.closed ?? g.CLOSED ?? 'N') === 'Y';
			return { name: archived ? `${name} (archived)` : name, value: id, description: `${type} ${id}` };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const loadOptions = {
	async getWorkgroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(await workgroups(this));
	},

	async getKanbans(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const groups = await workgroups(this).catch(() => []);
		return [{ name: 'My Plan (Webhook User)', value: 0, description: 'Personal stages of the user the webhook acts as' }, ...toOptions(groups)];
	},
};
