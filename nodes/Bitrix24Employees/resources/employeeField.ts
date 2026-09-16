import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties } from '../../../shared/params';
import { numberProperty, stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { yn } from '../../../shared/values';
import { limitOf, requiredId } from '../shared/helpers';

const fieldIdProperty = numberProperty('Field ID', 'fieldId', 'ID of the custom field, as Get Many returns it in ID');

const FIELD_TYPES = [
	{ name: 'Address', value: 'address' },
	{ name: 'Boolean', value: 'boolean' },
	{ name: 'CRM Item', value: 'crm' },
	{ name: 'CRM Status', value: 'crm_status' },
	{ name: 'Date', value: 'date' },
	{ name: 'Date and Time', value: 'datetime' },
	{ name: 'Employee', value: 'employee' },
	{ name: 'Enumeration', value: 'enumeration' },
	{ name: 'File', value: 'file' },
	{ name: 'Infoblock Element', value: 'iblock_element' },
	{ name: 'Infoblock Section', value: 'iblock_section' },
	{ name: 'Integer', value: 'integer' },
	{ name: 'Link', value: 'url' },
	{ name: 'Money', value: 'money' },
	{ name: 'Number', value: 'double' },
	{ name: 'String', value: 'string' },
];

function settingsOptions(forUpdate: boolean): INodeProperties {
	const options: INodeProperties[] = [
		{
			displayName: 'External ID',
			name: 'XML_ID',
			type: 'string',
			default: '',
			description: 'Your own code for the field, for finding it again from another system',
		},
		{
			displayName: 'Label',
			name: 'LABEL',
			type: 'string',
			default: '',
			description: 'Name people see. It fills the form, list and filter labels at once.',
		},
		{
			displayName: 'Required',
			name: 'MANDATORY',
			type: 'boolean',
			default: false,
			description: 'Whether the field has to be filled in',
		},
		{
			displayName: 'Searchable',
			name: 'IS_SEARCHABLE',
			type: 'boolean',
			default: false,
			description: 'Whether portal search looks inside this field',
		},
		{
			displayName: 'Settings (JSON)',
			name: 'SETTINGS',
			type: 'json',
			default: '{}',
			description:
				'Settings of the field type, e.g. {"DEFAULT_VALUE": 0, "SIZE": 20} for a string or {"DISPLAY": "UI"} for a list',
		},
		{
			displayName: 'Show in Filter',
			name: 'SHOW_FILTER',
			type: 'boolean',
			default: false,
			description: 'Whether the field appears in the filter of the employee list',
		},
		{
			displayName: 'Show in List',
			name: 'SHOW_IN_LIST',
			type: 'boolean',
			default: true,
			description: 'Whether the field appears as a column of the employee list',
		},
		{
			displayName: 'Sort Order',
			name: 'SORT',
			type: 'number',
			default: 100,
			description: 'Position among the other fields. Smaller comes first.',
		},
	];
	if (!forUpdate) {
		options.splice(2, 0, {
			displayName: 'Multiple',
			name: 'MULTIPLE',
			type: 'boolean',
			default: false,
			description: 'Whether the field holds several values at once. It cannot be changed afterwards.',
		});
	}
	return {
		displayName: forUpdate ? 'Update Fields' : 'Additional Fields',
		name: forUpdate ? 'updateFields' : 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options,
	};
}

export const employeeFieldResource: Resource = {
	value: 'employeeField',
	name: 'Custom Field',
	description: 'Custom fields of the employee card: skills, badges, anything the company tracks',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a custom employee field',
			description:
				'Add a custom field to every employee card. Bitrix24 upper-cases the code and puts UF_USR_ in front of it.',
			properties: [
				stringProperty('Code', 'fieldName', 'Code of the field, e.g. BADGE. It becomes UF_USR_BADGE.', true),
				{
					displayName: 'Type',
					name: 'userTypeId',
					type: 'options',
					default: 'string',
					options: FIELD_TYPES,
					description: 'What the field holds. It cannot be changed afterwards.',
				},
				settingsOptions(false),
			],
			async execute(itemIndex) {
				const extra = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject) };
				const settings = extra.SETTINGS;
				delete extra.SETTINGS;

				const fields: IDataObject = compact({
					FIELD_NAME: this.getNodeParameter('fieldName', itemIndex),
					USER_TYPE_ID: this.getNodeParameter('userTypeId', itemIndex),
					...extra,
				});
				for (const flag of ['MULTIPLE', 'MANDATORY', 'SHOW_FILTER', 'SHOW_IN_LIST', 'IS_SEARCHABLE']) {
					if (fields[flag] !== undefined) fields[flag] = yn(fields[flag]);
				}
				if (settings !== undefined && String(settings).trim() !== '' && String(settings).trim() !== '{}') {
					fields.SETTINGS = typeof settings === 'string' ? JSON.parse(settings) : settings;
				}

				const body = await bitrix24Request.call(this, 'user.userfield.add', { fields }, { itemIndex });
				return { id: Number(body.result) };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many custom employee fields',
			description: 'List the custom fields of the employee card, with their codes and types',
			properties: [
				...returnAllProperties('fields'),
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Filter over ID, FIELD_NAME, USER_TYPE_ID, XML_ID, SORT and the flags, e.g. {"USER_TYPE_ID": "string"}',
				},
				{
					displayName: 'Order (JSON)',
					name: 'orderJson',
					type: 'json',
					default: '{}',
					description: 'Sort object of field names and asc or desc, e.g. {"SORT": "asc"}',
				},
			],
			async execute(itemIndex) {
				const params: IDataObject = compact({
					filter: jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}),
					order: jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {}),
				});
				for (const key of ['filter', 'order']) {
					if (Object.keys((params[key] ?? {}) as IDataObject).length === 0) delete params[key];
				}
				const body = await bitrix24Request.call(this, 'user.userfield.list', params, { itemIndex });
				const rows = extractRows(body.result);
				const limit = limitOf(this, itemIndex);
				return limit === undefined ? rows : rows.slice(0, limit);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a custom employee field',
			description: 'Change the settings of a custom field. Its code and type stay as they are.',
			properties: [fieldIdProperty, settingsOptions(true)],
			async execute(itemIndex) {
				const chosen = { ...((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject) };
				const settings = chosen.SETTINGS;
				delete chosen.SETTINGS;

				const fields: IDataObject = compact(chosen);
				for (const flag of ['MANDATORY', 'SHOW_FILTER', 'SHOW_IN_LIST', 'IS_SEARCHABLE']) {
					if (fields[flag] !== undefined) fields[flag] = yn(fields[flag]);
				}
				if (settings !== undefined && String(settings).trim() !== '' && String(settings).trim() !== '{}') {
					fields.SETTINGS = typeof settings === 'string' ? JSON.parse(settings) : settings;
				}
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'No setting to change', { itemIndex });
				}

				await bitrix24Request.call(
					this,
					'user.userfield.update',
					{ id: requiredId(this, 'fieldId', itemIndex, 'Field ID'), fields },
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a custom employee field',
			description: 'Remove a custom field from every employee card, with the values kept in it',
			properties: [fieldIdProperty],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'user.userfield.delete',
					{ id: requiredId(this, 'fieldId', itemIndex, 'Field ID') },
					{ itemIndex },
				);
				return undefined;
			},
		},
	],
};
