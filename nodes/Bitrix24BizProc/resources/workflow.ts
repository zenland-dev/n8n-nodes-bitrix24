import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import {
	compact,
	jsonParameter,
	orderJsonProperty,
	returnAllProperties,
	selectProperty,
	stringList,
} from '../../../shared/params';
import { stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import {
	containerIdProperty,
	describeDocument,
	documentIdOf,
	documentIdProperty,
	documentKindProperty,
} from '../shared/documents';

/** What Bitrix24 returns when no field list is given: ID, MODIFIED, OWNED_UNTIL. */
const DEFAULT_FIELDS = ['ID', 'MODULE_ID', 'ENTITY', 'DOCUMENT_ID', 'TEMPLATE_ID', 'STARTED', 'STARTED_BY'];

const workflowIdProperty: INodeProperties = stringProperty(
	'Workflow ID',
	'workflowId',
	'ID of the running process, as Get Instances returns it: a string like 66e412fdc9bd44.36306599, not a number',
	true,
	'66e412fdc9bd44.36306599',
);

export const workflowResource: Resource = {
	value: 'workflow',
	name: 'Workflow',
	description: 'Business processes: start one on a record, list what is running, stop or delete it',
	operations: [
		{
			value: 'start',
			name: 'Start',
			action: 'Start a business process',
			description:
				'Start a business process from a template on one record — a deal, a lead, a list element, a Drive file',
			properties: [
				{
					displayName: 'Template ID',
					name: 'templateId',
					type: 'number',
					required: true,
					default: 0,
					description: 'ID of the template to start, as Template → Get Many returns it',
				},
				documentKindProperty,
				containerIdProperty,
				documentIdProperty('ID of the record the process runs on, e.g. 777 for deal 777'),
				{
					displayName: 'Parameters (JSON)',
					name: 'parametersJson',
					type: 'json',
					default: '{}',
					description:
						'Values for the parameters the template asks for, by their code, e.g. {"Parameter1": "user_1"}. A template without parameters takes none.',
				},
			],
			async execute(itemIndex) {
				const templateId = Number(this.getNodeParameter('templateId', itemIndex));
				if (!Number.isInteger(templateId) || templateId <= 0) {
					throw new NodeOperationError(this.getNode(), 'Template ID must be a positive whole number', { itemIndex });
				}

				const document = documentIdOf(this, itemIndex);
				const parameters = jsonParameter<IDataObject>(this, 'parametersJson', itemIndex, {});
				const params: IDataObject = { TEMPLATE_ID: templateId, DOCUMENT_ID: document };
				if (Object.keys(parameters).length > 0) params.PARAMETERS = parameters;

				const body = await bitrix24Request.call(this, 'bizproc.workflow.start', params, { itemIndex });
				return {
					workflowId: String(body.result ?? ''),
					templateId,
					...describeDocument(document[2]),
				};
			},
		},
		{
			value: 'getInstances',
			name: 'Get Instances',
			action: 'Get many running business processes',
			description: 'List the business processes that are running right now, with the record each one runs on',
			properties: [
				...returnAllProperties('running processes'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{
							displayName: 'Document ID',
							name: 'DOCUMENT_ID',
							type: 'string',
							default: '',
							placeholder: 'DEAL_777',
							description: 'Only the processes running on this record, spelled as Bitrix24 does: DEAL_777, LEAD_12',
						},
						{
							displayName: 'Module',
							name: 'MODULE_ID',
							type: 'options',
							default: 'crm',
							options: [
								{ name: 'CRM', value: 'crm' },
								{ name: 'Drive', value: 'disk' },
								{ name: 'Lists', value: 'lists' },
							],
							description: 'Only the processes of records of this module',
						},
						{
							displayName: 'Started By User ID',
							name: 'STARTED_BY',
							type: 'number',
							default: 0,
							description: 'Only the processes this user started',
						},
						{
							displayName: 'Template ID',
							name: 'TEMPLATE_ID',
							type: 'number',
							default: 0,
							description: 'Only the processes started from this template',
						},
					],
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Extra filter merged over Filters, e.g. {"&gt;=STARTED": "2026-09-01T00:00:00+03:00"}. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, ! or %.',
				},
				orderJsonProperty('{"STARTED": "DESC"}'),
				{
					...selectProperty('ID, TEMPLATE_ID, DOCUMENT_ID, STARTED'),
					description:
						'Comma-separated field names to return. Left empty, the node asks for the usual ones: Bitrix24 itself answers ID and two stamps.',
				},
			],
			async execute(itemIndex) {
				const chosen = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter: IDataObject = {
					...compact({
						DOCUMENT_ID: chosen.DOCUMENT_ID,
						MODULE_ID: chosen.MODULE_ID,
						STARTED_BY: chosen.STARTED_BY === 0 ? undefined : chosen.STARTED_BY,
						TEMPLATE_ID: chosen.TEMPLATE_ID === 0 ? undefined : chosen.TEMPLATE_ID,
					}),
					...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}),
				};

				const params: IDataObject = {};
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.ORDER = order;
				// Asked for nothing, the method answers ID, MODIFIED and OWNED_UNTIL — checked on a
				// live portal, 17.09.2026. An empty field list therefore means the usual fields.
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				params.SELECT = select.length > 0 ? select : DEFAULT_FIELDS;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				const instances = await listAll.call(this, 'bizproc.workflow.instances', params, { limit, itemIndex });
				return instances.map((instance) => ({ ...instance, ...describeDocument(instance.DOCUMENT_ID) }));
			},
		},
		{
			value: 'terminate',
			name: 'Terminate',
			action: 'Terminate a business process',
			description: 'Stop a running business process and keep everything it has done so far, with a reason in the log',
			properties: [
				workflowIdProperty,
				stringProperty('Status Text', 'status', 'Why it was stopped; shown in the process log', false, 'Stopped by n8n'),
			],
			async execute(itemIndex) {
				const id = String(this.getNodeParameter('workflowId', itemIndex, '')).trim();
				if (id === '') {
					throw new NodeOperationError(this.getNode(), 'Workflow ID is required', { itemIndex });
				}
				const status = String(this.getNodeParameter('status', itemIndex, '')).trim();
				const params: IDataObject = { ID: id };
				if (status !== '') params.STATUS = status;

				const body = await bitrix24Request.call(this, 'bizproc.workflow.terminate', params, { itemIndex });
				return { workflowId: id, terminated: body.result === true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a business process',
			description: 'Delete a running business process together with its data; the log of it goes as well',
			properties: [workflowIdProperty],
			async execute(itemIndex) {
				const id = String(this.getNodeParameter('workflowId', itemIndex, '')).trim();
				if (id === '') {
					throw new NodeOperationError(this.getNode(), 'Workflow ID is required', { itemIndex });
				}
				// Documented as an integer, but an instance ID is the same string Terminate takes,
				// and Bitrix24 answers ERROR_ACTIVITY_NOT_FOUND to anything else.
				const body = await bitrix24Request.call(this, 'bizproc.workflow.kill', { ID: id }, { itemIndex });
				return { workflowId: id, deleted: body.result === true };
			},
		},
	],
};
