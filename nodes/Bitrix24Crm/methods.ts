import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperFields,
} from 'n8n-workflow';

import { editorEntityTypeId, ENTITY_TYPE_OPTIONS } from './shared/entityTypes';
import { categories, itemFields, smartProcessTypes, statuses, statusesOfType } from './shared/dictionaries';
import { toMapperFields } from './shared/mapper';

function byName(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name);
}

export const loadOptions = {
	async getEntityTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const spa = await smartProcessTypes.call(this).catch(() => []);
		return [
			...ENTITY_TYPE_OPTIONS,
			...spa
				.map((t) => ({ name: `Smart Process: ${String(t.title)}`, value: Number(t.entityTypeId) }))
				.sort(byName),
		];
	},

	async getSmartProcessTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return (await smartProcessTypes.call(this))
			.map((t) => ({ name: String(t.title), value: Number(t.entityTypeId), description: `Entity type ${String(t.entityTypeId)}` }))
			.sort(byName);
	},

	async getCategories(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const entityTypeId = editorEntityTypeId(this);
		if (entityTypeId === undefined) return [];
		const list = await categories.call(this, entityTypeId).catch(() => []);
		return list.map((c) => ({ name: String(c.name), value: Number(c.id) }));
	},

	async getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const entityTypeId = editorEntityTypeId(this);
		if (entityTypeId === undefined) return [];
		const fields = await itemFields.call(this, entityTypeId);
		const statusType = fields.stageId?.statusType;
		if (statusType === undefined) return [];

		const entries = statusesOfType(await statuses.call(this), statusType);
		const pipelines = new Map(
			(await categories.call(this, entityTypeId).catch(() => [])).map((c) => [String(c.id), String(c.name)]),
		);
		const several = new Set(entries.map((e) => String(e.ENTITY_ID))).size > 1;
		return entries.map((e) => {
			const categoryId = String(e.ENTITY_ID).slice(statusType.length + 1) || '0';
			return {
				name: several ? `${pipelines.get(categoryId) ?? categoryId} / ${String(e.NAME)}` : String(e.NAME),
				value: String(e.STATUS_ID),
			};
		});
	},
};

async function mapperFields(ctx: ILoadOptionsFunctions, purpose: 'create' | 'update'): Promise<ResourceMapperFields> {
	const entityTypeId = editorEntityTypeId(ctx);
	if (entityTypeId === undefined) {
		return { fields: [], emptyFieldsNotice: 'Pick a smart process first.' };
	}
	const fields = await itemFields.call(ctx, entityTypeId);
	return { fields: await toMapperFields(ctx, entityTypeId, fields, purpose) };
}

export const resourceMapping = {
	async getFieldsForCreate(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		return await mapperFields(this, 'create');
	},
	async getFieldsForUpdate(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		return await mapperFields(this, 'update');
	},
};
