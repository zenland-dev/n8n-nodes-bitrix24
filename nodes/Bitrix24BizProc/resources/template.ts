import type { IDataObject } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import {
	jsonParameter,
	orderJsonProperty,
	returnAllProperties,
	selectProperty,
	stringList,
} from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { containerIdProperty, documentKindProperty, documentType } from '../shared/documents';

/** What Bitrix24 returns when no field list is given: ID alone. These are the useful ones. */
const DEFAULT_FIELDS = ['ID', 'NAME', 'MODULE_ID', 'ENTITY', 'DOCUMENT_TYPE', 'AUTO_EXECUTE', 'USER_ID', 'MODIFIED'];

export const templateResource: Resource = {
	value: 'template',
	name: 'Template',
	description: 'Business process templates of the portal, and which records each one runs on',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many business process templates',
			description:
				'List the business process templates, with their parameters and variables, to find the ID Workflow → Start needs',
			properties: [
				...returnAllProperties('templates'),
				{
					displayName: 'Limit to One Document Type',
					name: 'byDocumentType',
					type: 'boolean',
					default: false,
					description: 'Whether to list only the templates of one kind of record, e.g. deals',
				},
				{ ...documentKindProperty, displayOptions: { show: { byDocumentType: [true] } } },
				{
					...containerIdProperty,
					displayOptions: {
						show: {
							byDocumentType: [true],
							documentKind: containerIdProperty.displayOptions?.show?.documentKind ?? [],
						},
					},
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Extra filter merged over the document type, e.g. {"AUTO_EXECUTE": 0} for templates started by hand, or {"MODULE_ID": "lists"}',
				},
				orderJsonProperty('{"ID": "DESC"}'),
				{
					...selectProperty('ID, NAME, DOCUMENT_TYPE, AUTO_EXECUTE'),
					description:
						'Comma-separated field names to return. Left empty, the node asks for the usual ones: Bitrix24 itself answers nothing but ID.',
				},
			],
			async execute(itemIndex) {
				const filter: IDataObject = { ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) };
				if (this.getNodeParameter('byDocumentType', itemIndex, false) === true) {
					filter.DOCUMENT_TYPE = documentType(this, itemIndex);
				}

				const params: IDataObject = {};
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.ORDER = order;
				// Asked for nothing, the method answers rows of ID and nothing else — checked on a
				// live portal, 17.09.2026. An empty field list therefore means the usual fields.
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				params.SELECT = select.length > 0 ? select : DEFAULT_FIELDS;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				return await listAll.call(this, 'bizproc.workflow.template.list', params, { limit, itemIndex });
			},
		},
	],
};
