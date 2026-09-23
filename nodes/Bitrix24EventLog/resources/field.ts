import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { ENTRY_FIELDS, FILTERABLE_FIELDS, selectFields, v3Item } from '../shared/helpers';

/** What a field description itself holds. Asking for fewer keeps the output short. */
const DESCRIPTION_FIELDS =
	'name, type, title, description, validationRules, requiredGroups, filterable, sortable, editable, multiple, elementType';

const selectDescriptionProperty: INodeProperties = {
	displayName: 'Fields to Return',
	name: 'select',
	type: 'string',
	default: '',
	placeholder: 'name, type, filterable, sortable',
	description: `Comma-separated keys of the description. Leave empty for all of them: ${DESCRIPTION_FIELDS}.`,
};

export const fieldResource: Resource = {
	value: 'field',
	name: 'Field',
	description: 'What an entry of the log is made of, and which of its fields can be filtered or sorted',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many event log fields',
			description: `Describe every field of a log entry: ${ENTRY_FIELDS}`,
			properties: [selectDescriptionProperty],
			async execute(itemIndex) {
				const params: IDataObject = {};
				const select = selectFields(this, itemIndex);
				if (select !== undefined) params.select = select;

				const body = await bitrix24Request.call(this, 'main.eventlog.field.list', params, { v3: true, itemIndex });
				return v3Item(body, 'items');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an event log field',
			description: `Describe one field of a log entry. Only ${FILTERABLE_FIELDS} answer true to filterable and sortable.`,
			properties: [
				{
					displayName: 'Field Name',
					name: 'fieldName',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'timestampX',
					description: `Name of the field, spelled as Get Many returns it: ${ENTRY_FIELDS}`,
				},
				selectDescriptionProperty,
			],
			async execute(itemIndex) {
				const name = String(this.getNodeParameter('fieldName', itemIndex, '')).trim();
				if (name === '') {
					throw new NodeOperationError(this.getNode(), 'Field Name is required', { itemIndex });
				}

				const params: IDataObject = { name };
				const select = selectFields(this, itemIndex);
				if (select !== undefined) params.select = select;

				const body = await bitrix24Request.call(this, 'main.eventlog.field.get', params, { v3: true, itemIndex });
				return v3Item(body, 'item');
			},
		},
	],
};
