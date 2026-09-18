import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, jsonParameter, stringList } from '../../../shared/params';
import { rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { listTarget, listTargetProperties, nameById } from '../shared/helpers';

const sectionIdProperty: INodeProperties = {
	displayName: 'Section ID',
	name: 'sectionId',
	type: 'number',
	default: 0,
	description: 'ID of the section, as Get Many returns it. Give this or Section Code.',
};

const sectionCodeProperty: INodeProperties = {
	displayName: 'Section Code',
	name: 'sectionCode',
	type: 'string',
	default: '',
	description: 'Symbolic code of the section, instead of its ID',
};

const sectionSettingsProperty: INodeProperties = {
	displayName: 'Settings',
	name: 'settings',
	type: 'collection',
	placeholder: 'Add Setting',
	default: {},
	options: [
		{
			displayName: 'Active',
			name: 'ACTIVE',
			type: 'boolean',
			default: true,
			description: 'Whether the section is shown in the list',
		},
		{
			displayName: 'External ID',
			name: 'EXTERNAL_ID',
			type: 'string',
			default: '',
			description: 'Identifier of the section in whatever system the data came from',
		},
		{
			displayName: 'Sort Order',
			name: 'SORT',
			type: 'number',
			default: 500,
			description: 'Where the section stands among the others; smaller comes first',
		},
	],
};

function sectionOf(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return nameById(ctx, itemIndex, 'sectionId', 'sectionCode', 'SECTION_ID', 'SECTION_CODE', 'section');
}

function settingsFrom(chosen: IDataObject): IDataObject {
	const fields = compact({ SORT: chosen.SORT, EXTERNAL_ID: chosen.EXTERNAL_ID });
	if (chosen.ACTIVE !== undefined) fields.ACTIVE = chosen.ACTIVE === true ? 'Y' : 'N';
	return fields;
}

export const sectionResource: Resource = {
	value: 'section',
	name: 'Section',
	description: 'Sections of a list, the folders elements are grouped into',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many list sections',
			description: 'Read the sections of a list, all of them or the ones a filter names',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Filter by section field, e.g. {"NAME": "Contracts"} or {"IBLOCK_SECTION_ID": 12} for the subsections of one section',
				},
				{
					displayName: 'Fields to Return',
					name: 'select',
					type: 'string',
					default: '',
					placeholder: 'ID, NAME, IBLOCK_SECTION_ID',
					description: 'Comma-separated field names to return. Leave empty for the default set.',
				},
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (select.length > 0) params.SELECT = select;

				// The method reads every section at once: it has no paging of its own.
				const body = await bitrix24Request.call(this, 'lists.section.get', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'create',
			name: 'Create',
			action: 'Create a list section',
			description: 'Add a section to a list, at its root or inside another section',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Name of the section',
				},
				{
					displayName: 'Section Code',
					name: 'sectionCode',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'contracts',
					description: 'Symbolic code of the new section, unique within the list',
				},
				{
					displayName: 'Parent Section ID',
					name: 'parentSectionId',
					type: 'number',
					default: 0,
					description: 'Section to nest the new one in. 0 puts it at the root of the list.',
				},
				sectionSettingsProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				const code = String(this.getNodeParameter('sectionCode', itemIndex, '')).trim();
				if (name === '' || code === '') {
					throw new NodeOperationError(this.getNode(), 'Name and Section Code are both required', { itemIndex });
				}

				params.SECTION_CODE = code;
				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				params.FIELDS = { NAME: name, ...settingsFrom(chosen) };
				const parentId = Number(this.getNodeParameter('parentSectionId', itemIndex, 0));
				if (Number.isInteger(parentId) && parentId > 0) params.IBLOCK_SECTION_ID = parentId;

				const body = await bitrix24Request.call(this, 'lists.section.add', params, { itemIndex });
				return { sectionId: Number(body.result) || null, code, name };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a list section',
			description: 'Rename a section or change its settings; what you leave out stays as it is',
			properties: [
				...listTargetProperties(),
				sectionIdProperty,
				sectionCodeProperty,
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					default: '',
					description: 'New name of the section. Leave empty to keep the current one.',
				},
				sectionSettingsProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, sectionOf(this, itemIndex));

				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				const fields = settingsFrom(chosen);
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				if (name !== '') fields.NAME = name;
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to update: set a name or at least one setting', {
						itemIndex,
					});
				}
				params.FIELDS = fields;

				const body = await bitrix24Request.call(this, 'lists.section.update', params, { itemIndex });
				return {
					sectionId: params.SECTION_ID ?? null,
					code: params.SECTION_CODE ?? null,
					updated: body.result === true,
				};
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a list section',
			description: 'Delete a section of a list together with the elements inside it',
			properties: [...listTargetProperties(), sectionIdProperty, sectionCodeProperty],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, sectionOf(this, itemIndex));

				const body = await bitrix24Request.call(this, 'lists.section.delete', params, { itemIndex });
				return {
					sectionId: params.SECTION_ID ?? null,
					code: params.SECTION_CODE ?? null,
					deleted: body.result === true,
				};
			},
		},
	],
};
