import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import { positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { listTarget, listTargetProperties, nameById } from '../shared/helpers';

const elementIdProperty: INodeProperties = {
	displayName: 'Element ID',
	name: 'elementId',
	type: 'number',
	default: 0,
	description: 'ID of the element, as Get Many returns it. Give this or Element Code.',
};

const elementCodeProperty: INodeProperties = {
	displayName: 'Element Code',
	name: 'elementCode',
	type: 'string',
	default: '',
	description: 'Symbolic code of the element, instead of its ID',
};

const elementFieldsProperty: INodeProperties = {
	displayName: 'Fields (JSON)',
	name: 'fieldsJson',
	type: 'json',
	default: '{}',
	description:
		'Values of the element by field code, e.g. {"PROPERTY_951": ["1269"], "PROPERTY_1003": "2024-12-31 23:59:59"}. A multiple field takes an array even for one value; Field → Get Many gives the codes.',
};

function elementOf(ctx: IExecuteFunctions, itemIndex: number, required = true): IDataObject {
	return nameById(ctx, itemIndex, 'elementId', 'elementCode', 'ELEMENT_ID', 'ELEMENT_CODE', 'element', required);
}

export const elementResource: Resource = {
	value: 'element',
	name: 'Element',
	description: 'The rows of a list: reading them, adding, changing, deleting, and links to their files',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many list elements',
			description: 'Read the elements of a list, filtered and sorted, or one element by its ID or code',
			properties: [
				...returnAllProperties('elements'),
				...listTargetProperties(),
				elementIdProperty,
				elementCodeProperty,
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Filter by field code, e.g. {"=PROPERTY_951": 1269, "&gt;=DATE_CREATE": "2026-09-01"}. Prefix a field with =, !, &gt;, &gt;=, &lt;, &lt;= or %.',
				},
				{
					displayName: 'Order (JSON)',
					name: 'orderJson',
					type: 'json',
					default: '{}',
					description: 'Sort object of field codes, e.g. {"ID": "DESC"} or {"PROPERTY_951": "ASC"}',
				},
				{
					displayName: 'Fields to Return',
					name: 'select',
					type: 'string',
					default: '',
					placeholder: 'ID, NAME, PROPERTY_951',
					description: 'Comma-separated field codes to return. Leave empty for the default set.',
				},
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, elementOf(this, itemIndex, false));

				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.ELEMENT_ORDER = order;
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (select.length > 0) params.SELECT = select;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				return await listAll.call(this, 'lists.element.get', params, { limit, itemIndex });
			},
		},
		{
			value: 'create',
			name: 'Create',
			action: 'Create a list element',
			description: 'Add an element to a list, in a section or at its root',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Name of the element, the one column every list has',
				},
				{
					displayName: 'Element Code',
					name: 'elementCode',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'request_2026_09',
					description: 'Symbolic code of the new element, unique within the list',
				},
				{
					displayName: 'Section ID',
					name: 'sectionId',
					type: 'number',
					default: 0,
					description: 'Section to put the element in. 0 leaves it at the root of the list.',
				},
				elementFieldsProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				const code = String(this.getNodeParameter('elementCode', itemIndex, '')).trim();
				if (name === '' || code === '') {
					throw new NodeOperationError(this.getNode(), 'Name and Element Code are both required', { itemIndex });
				}

				params.ELEMENT_CODE = code;
				params.FIELDS = { NAME: name, ...jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {}) };
				const sectionId = Number(this.getNodeParameter('sectionId', itemIndex, 0));
				if (Number.isInteger(sectionId) && sectionId > 0) params.IBLOCK_SECTION_ID = sectionId;

				const body = await bitrix24Request.call(this, 'lists.element.add', params, { itemIndex });
				return { elementId: Number(body.result) || null, code, name };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a list element',
			description: 'Change the values of one element; fields you leave out keep what they hold',
			properties: [
				...listTargetProperties(),
				elementIdProperty,
				elementCodeProperty,
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					default: '',
					description: 'New name of the element. Leave empty to keep the current one.',
				},
				elementFieldsProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, elementOf(this, itemIndex));

				const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				if (name !== '') fields.NAME = name;
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to update: set a name or at least one field', {
						itemIndex,
					});
				}
				params.FIELDS = fields;

				const body = await bitrix24Request.call(this, 'lists.element.update', params, { itemIndex });
				return {
					elementId: params.ELEMENT_ID ?? null,
					code: params.ELEMENT_CODE ?? null,
					updated: body.result === true,
				};
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a list element',
			description: 'Delete one element of a list',
			properties: [...listTargetProperties(), elementIdProperty, elementCodeProperty],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, elementOf(this, itemIndex));

				const body = await bitrix24Request.call(this, 'lists.element.delete', params, { itemIndex });
				return {
					elementId: params.ELEMENT_ID ?? null,
					code: params.ELEMENT_CODE ?? null,
					deleted: body.result === true,
				};
			},
		},
		{
			value: 'getFileUrl',
			name: 'Get File URL',
			action: 'Get the link to a file of a list element',
			description: 'Get the download link of a File or File (Drive) field of one element',
			properties: [
				...listTargetProperties(),
				elementIdProperty,
				elementCodeProperty,
				{
					displayName: 'Field ID',
					name: 'fieldId',
					type: 'number',
					required: true,
					default: 0,
					description: 'ID of the file field, without the PROPERTY_ prefix: 951 for PROPERTY_951',
				},
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				Object.assign(params, elementOf(this, itemIndex));
				params.FIELD_ID = positiveInt(this, 'fieldId', itemIndex, 'Field ID');

				const body = await bitrix24Request.call(this, 'lists.element.get.file.url', params, { itemIndex });
				const result = body.result;
				// A File field answers an array of links, one per value; a File (Drive) field the
				// same, and both are paths on the portal, not full addresses.
				const links = Array.isArray(result)
					? result.map((url) => String(url))
					: result !== null && typeof result === 'object'
						? Object.values(result as IDataObject).map((url) => String(url))
						: [];

				return links.map((url) => ({
					fieldId: params.FIELD_ID,
					url,
					elementId: params.ELEMENT_ID ?? null,
					elementCode: params.ELEMENT_CODE ?? null,
				}));
			},
		},
	],
};
