import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, jsonParameter } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { rows } from '../../../shared/props';
import { listTarget, listTargetProperties } from '../shared/helpers';

/** TYPE of lists.field.add, both the custom types and the system ones. */
const FIELD_TYPES = [
	{ name: 'CRM Element Binding', value: 'S:ECrm', description: 'A link to a lead, deal, contact or company' },
	{ name: 'Date', value: 'S:Date' },
	{ name: 'Date/Time', value: 'S:DateTime' },
	{ name: 'Element Binding', value: 'E', description: 'A link to an element of another list' },
	{ name: 'Element Binding as List', value: 'E:EList', description: 'The same link, shown as a dropdown' },
	{ name: 'Employee Binding', value: 'S:employee' },
	{ name: 'File', value: 'F' },
	{ name: 'File (Drive)', value: 'S:DiskFile' },
	{ name: 'HTML/Text', value: 'S:HTML' },
	{ name: 'List', value: 'L', description: 'A dropdown of values set in the field itself' },
	{ name: 'Money', value: 'S:Money' },
	{ name: 'Number', value: 'N' },
	{ name: 'Number Counter', value: 'N:Sequence', description: 'A number that counts up on its own' },
	{ name: 'Section Binding', value: 'G', description: 'A link to a section of a list' },
	{ name: 'String', value: 'S' },
];

const fieldIdProperty: INodeProperties = {
	displayName: 'Field ID',
	name: 'fieldId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'PROPERTY_951',
	description: 'ID of the field as Get Many returns it, e.g. PROPERTY_951 or a system field like NAME',
};

const fieldSettingsProperty: INodeProperties = {
	displayName: 'Settings',
	name: 'settings',
	type: 'collection',
	placeholder: 'Add Setting',
	default: {},
	options: [
		{
			displayName: 'Default Value',
			name: 'DEFAULT_VALUE',
			type: 'string',
			default: '',
			description: 'What a new element gets when nothing is filled in',
		},
		{
			displayName: 'Linked List ID',
			name: 'LINK_IBLOCK_ID',
			type: 'number',
			default: 0,
			description: 'For an element or section binding: the list it points at',
		},
		{
			displayName: 'Multiple',
			name: 'MULTIPLE',
			type: 'boolean',
			default: false,
			description: 'Whether the field holds several values at once',
		},
		{
			displayName: 'Required',
			name: 'IS_REQUIRED',
			type: 'boolean',
			default: false,
			description: 'Whether an element cannot be saved without this field',
		},
		{
			displayName: 'Sort Order',
			name: 'SORT',
			type: 'number',
			default: 500,
			description: 'Where the field stands among the others; smaller comes first',
		},
		{
			displayName: 'Values of a List Field',
			name: 'LIST_TEXT_VALUES',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: 'Values of a List field, one per line. Only a List field uses it.',
		},
	],
};

const fieldExtraProperty: INodeProperties = {
	displayName: 'Extra Settings (JSON)',
	name: 'extraJson',
	type: 'json',
	default: '{}',
	description:
		'Settings merged over the ones above, for what has no field here: SETTINGS, USER_TYPE_SETTINGS, LIST, LIST_DEF, ROW_COUNT, COL_COUNT',
};

function fieldsFrom(chosen: IDataObject): IDataObject {
	const fields = compact({
		SORT: chosen.SORT,
		DEFAULT_VALUE: chosen.DEFAULT_VALUE,
		LIST_TEXT_VALUES: chosen.LIST_TEXT_VALUES,
		LINK_IBLOCK_ID: chosen.LINK_IBLOCK_ID === 0 ? undefined : chosen.LINK_IBLOCK_ID,
	});
	if (chosen.IS_REQUIRED !== undefined) fields.IS_REQUIRED = chosen.IS_REQUIRED === true ? 'Y' : 'N';
	if (chosen.MULTIPLE !== undefined) fields.MULTIPLE = chosen.MULTIPLE === true ? 'Y' : 'N';
	return fields;
}

export const fieldResource: Resource = {
	value: 'field',
	name: 'Field',
	description: 'The columns of a list: what they are called, of what type, and adding or removing one',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many list fields',
			description: 'Read the fields of a list with their codes and types — the codes every element operation needs',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Field ID',
					name: 'fieldId',
					type: 'string',
					default: '',
					placeholder: 'PROPERTY_951',
					description: 'Only this field. Leave empty for every field of the list.',
				},
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const fieldId = String(this.getNodeParameter('fieldId', itemIndex, '')).trim();
				if (fieldId !== '') params.FIELD_ID = fieldId;

				const body = await bitrix24Request.call(this, 'lists.field.get', params, { itemIndex });
				// Answers an object keyed by field code, so each field becomes one item with its code.
				const result = (body.result ?? {}) as IDataObject;
				if (Array.isArray(result)) return rows(result);
				return Object.entries(result).map(([code, field]) => ({
					fieldId: code,
					...((field ?? {}) as IDataObject),
				}));
			},
		},
		{
			value: 'getTypes',
			name: 'Get Types',
			action: 'Get the field types of a list',
			description: 'Read which field types this list allows, as Bitrix24 names them',
			properties: listTargetProperties(),
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const body = await bitrix24Request.call(this, 'lists.field.type.get', params, { itemIndex });
				const result = (body.result ?? {}) as IDataObject;
				if (Array.isArray(result)) return rows(result);
				return Object.entries(result).map(([type, title]) => ({ type, title }));
			},
		},
		{
			value: 'create',
			name: 'Create',
			action: 'Create a list field',
			description: 'Add a field to a list. Its type is fixed once created; changing it means a new field.',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Name of the field, as people see it in the list',
				},
				{
					displayName: 'Field Code',
					name: 'fieldCode',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'AMOUNT',
					description:
						'Symbolic code of the field. Bitrix24 refuses a new field without one — "Please fill the code fields", error ERROR_SAVE_FIELD — although its documentation marks CODE optional.',
				},
				{
					displayName: 'Type',
					name: 'type',
					type: 'options',
					default: 'S',
					options: FIELD_TYPES,
					description: 'What the field holds',
				},
				fieldSettingsProperty,
				fieldExtraProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				const code = String(this.getNodeParameter('fieldCode', itemIndex, '')).trim();
				if (name === '' || code === '') {
					throw new NodeOperationError(this.getNode(), 'Name and Field Code are both required', { itemIndex });
				}

				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				params.FIELDS = {
					NAME: name,
					CODE: code,
					TYPE: String(this.getNodeParameter('type', itemIndex, 'S')),
					...fieldsFrom(chosen),
					...jsonParameter<IDataObject>(this, 'extraJson', itemIndex, {}),
				};

				const body = await bitrix24Request.call(this, 'lists.field.add', params, { itemIndex });
				return { fieldId: body.result ?? null, name };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a list field',
			description: 'Change the name or the settings of a field. Bitrix24 wants the type again even unchanged.',
			properties: [
				...listTargetProperties(),
				fieldIdProperty,
				{
					displayName: 'Type',
					name: 'type',
					type: 'options',
					default: 'S',
					options: FIELD_TYPES,
					description: 'The type the field already has. Bitrix24 requires it and refuses to change it.',
				},
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					default: '',
					description: 'New name of the field. Leave empty to keep the current one.',
				},
				fieldSettingsProperty,
				fieldExtraProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const fieldId = String(this.getNodeParameter('fieldId', itemIndex, '')).trim();
				if (fieldId === '') {
					throw new NodeOperationError(this.getNode(), 'Field ID is required', { itemIndex });
				}
				params.FIELD_ID = fieldId;

				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				const fields: IDataObject = {
					TYPE: String(this.getNodeParameter('type', itemIndex, 'S')),
					...fieldsFrom(chosen),
					...jsonParameter<IDataObject>(this, 'extraJson', itemIndex, {}),
				};
				if (name !== '') fields.NAME = name;
				params.FIELDS = fields;

				const body = await bitrix24Request.call(this, 'lists.field.update', params, { itemIndex });
				return { fieldId, updated: body.result === true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a list field',
			description: 'Delete a field of a list together with the values every element holds in it',
			properties: [...listTargetProperties(), fieldIdProperty],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const fieldId = String(this.getNodeParameter('fieldId', itemIndex, '')).trim();
				if (fieldId === '') {
					throw new NodeOperationError(this.getNode(), 'Field ID is required', { itemIndex });
				}
				params.FIELD_ID = fieldId;

				const body = await bitrix24Request.call(this, 'lists.field.delete', params, { itemIndex });
				return { fieldId, deleted: body.result === true };
			},
		},
	],
};
