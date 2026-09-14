import type { IDataObject } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';

export const methodResource: Resource = {
	value: 'method',
	name: 'Method',
	description: 'Call any Bitrix24 REST method by name',
	operations: [
		{
			value: 'call',
			name: 'Call',
			action: 'Call a Bitrix24 REST method',
			description:
				'Call any method of the Bitrix24 REST API by name with a JSON body — for everything the other Bitrix24 nodes do not cover',
			properties: [
				{
					displayName: 'Method',
					name: 'method',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'crm.item.list',
					description:
						'The REST method name exactly as in the Bitrix24 documentation at apidocs.bitrix24.com, e.g. crm.item.list, tasks.task.add, im.notify.personal.add',
				},
				{
					displayName: 'Parameters (JSON)',
					name: 'parameters',
					type: 'json',
					default: '{}',
					description:
						'The method parameters as a JSON object, e.g. {"entityTypeId": 2, "select": ["title", "stageId"]}',
				},
				{
					displayName: 'API Version',
					name: 'apiVersion',
					type: 'options',
					default: 'v2',
					options: [
						{
							name: 'Classic REST',
							value: 'v2',
							description: 'The /rest/ endpoint that almost every method lives on',
						},
						{
							name: 'REST 3.0',
							value: 'v3',
							description:
								'The /rest/api/ endpoint. Some newer methods — event log, mailboxes, org structure, time records — exist only here.',
						},
					],
				},
				{
					displayName: 'Pagination',
					name: 'pagination',
					type: 'options',
					default: 'none',
					description: 'How to treat a list method that answers 50 records per page',
					options: [
						{
							name: 'First Page Only',
							value: 'none',
							description: 'Send the request once and return the answer as it came',
						},
						{
							name: 'Follow Pages',
							value: 'offset',
							description:
								'Repeat with start = next until Bitrix24 stops sending next. Works for every list method, but makes Bitrix24 count the total on each page.',
						},
						{
							name: 'Page by ID',
							value: 'id',
							description:
								'Filter by ID above the last one received, with start = -1. Much faster on large lists; only for methods that sort and filter by an ID field.',
						},
					],
				},
				{
					displayName: 'ID Field',
					name: 'idField',
					type: 'string',
					default: 'id',
					displayOptions: { show: { pagination: ['id'] } },
					description:
						'Name of the ID field exactly as the method spells it: lowercase for crm.item.list, uppercase for crm.deal.list',
				},
				{
					displayName: 'Rows Key',
					name: 'itemsKey',
					type: 'string',
					default: '',
					displayOptions: { show: { pagination: ['offset', 'id'] } },
					placeholder: 'items',
					description:
						'Where the rows are inside result — items for crm.item.list, tasks for tasks.task.list. Leave empty when result is the list itself or holds a single list.',
				},
				{
					displayName: 'Max Rows',
					name: 'maxRows',
					type: 'number',
					typeOptions: { minValue: 0 },
					default: 0,
					displayOptions: { show: { pagination: ['offset', 'id'] } },
					description: 'Stop after this many rows. 0 reads every page.',
				},
				{
					displayName: 'Output',
					name: 'output',
					type: 'options',
					default: 'result',
					displayOptions: { show: { pagination: ['none'] } },
					options: [
						{
							name: 'Full Response',
							value: 'full',
							description: 'The whole answer with next, total and time as one item',
						},
						{
							name: 'Result',
							value: 'result',
							description: 'Only the result field; a list becomes one item per row',
						},
					],
				},
			],
			async execute(itemIndex) {
				const method = String(this.getNodeParameter('method', itemIndex)).trim();
				const params = jsonParameter<IDataObject>(this, 'parameters', itemIndex, {});
				const v3 = this.getNodeParameter('apiVersion', itemIndex) === 'v3';
				const pagination = this.getNodeParameter('pagination', itemIndex) as string;

				if (pagination !== 'none') {
					const maxRows = Number(this.getNodeParameter('maxRows', itemIndex, 0)) || undefined;
					const itemsKey = String(this.getNodeParameter('itemsKey', itemIndex, '')).trim();
					const idField =
						pagination === 'id'
							? String(this.getNodeParameter('idField', itemIndex, 'id')).trim() || 'id'
							: undefined;
					return await listAll.call(this, method, params, {
						itemsKey,
						idField,
						limit: maxRows,
						v3,
						itemIndex,
					});
				}

				const body = await bitrix24Request.call(this, method, params, { v3, itemIndex });
				if (this.getNodeParameter('output', itemIndex) === 'full') return body;

				const result = body.result;
				if (Array.isArray(result)) {
					return result.map((row) =>
						row !== null && typeof row === 'object' ? (row as IDataObject) : { value: row as IDataObject[keyof IDataObject] },
					);
				}
				if (result !== null && typeof result === 'object') return result as IDataObject;
				return { result: result as IDataObject[keyof IDataObject] };
			},
		},
	],
};
