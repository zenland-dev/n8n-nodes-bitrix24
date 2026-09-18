import type { IDataObject } from 'n8n-workflow';
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
import { numberProperty, positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList } from '../../../shared/values';

/** USER_STATUS as bizproc.task.list returns it. */
const TASK_STATUSES = [
	{ name: 'Waiting', value: 0 },
	{ name: 'Answered Yes', value: 1 },
	{ name: 'Answered No', value: 2 },
	{ name: 'Cancelled', value: 3 },
];

export const taskResource: Resource = {
	value: 'task',
	name: 'Task',
	description: 'Tasks a running process puts in front of people: approvals, questions, acknowledgements',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many business process tasks',
			description: 'List the tasks of running business processes, by default the ones waiting for an answer',
			properties: [
				...returnAllProperties('tasks'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{
							displayName: 'Answer',
							name: 'USER_STATUS',
							type: 'options',
							default: 0,
							options: TASK_STATUSES,
							description: 'Only the tasks the user has answered this way',
						},
						{
							displayName: 'Document Name',
							name: 'DOCUMENT_NAME',
							type: 'string',
							default: '',
							description: 'Only the tasks whose document is named exactly this',
						},
						{
							displayName: 'Template ID',
							name: 'WORKFLOW_TEMPLATE_ID',
							type: 'number',
							default: 0,
							description: 'Only the tasks of processes started from this template',
						},
						{
							displayName: 'User ID',
							name: 'USER_ID',
							type: 'number',
							default: 0,
							description: 'Only the tasks of this user. Leave out for the tasks of the webhook user.',
						},
						{
							displayName: 'Workflow ID',
							name: 'WORKFLOW_ID',
							type: 'string',
							default: '',
							description: 'Only the tasks of one running process',
						},
					],
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Extra filter merged over Filters, e.g. {"&gt;=OVERDUE_DATE": "2026-09-01"}. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, ! or %.',
				},
				orderJsonProperty('{"MODIFIED": "DESC"}'),
				selectProperty('ID, WORKFLOW_ID, DOCUMENT_NAME, OVERDUE_DATE'),
			],
			async execute(itemIndex) {
				const chosen = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter: IDataObject = {
					...compact({
						USER_ID: chosen.USER_ID === 0 ? undefined : chosen.USER_ID,
						WORKFLOW_ID: chosen.WORKFLOW_ID,
						WORKFLOW_TEMPLATE_ID: chosen.WORKFLOW_TEMPLATE_ID === 0 ? undefined : chosen.WORKFLOW_TEMPLATE_ID,
						DOCUMENT_NAME: chosen.DOCUMENT_NAME,
					}),
					...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}),
				};
				// 0 is "waiting", a meaningful answer, so it cannot go through compact.
				if (chosen.USER_STATUS !== undefined) filter.USER_STATUS = chosen.USER_STATUS;

				const params: IDataObject = {};
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.ORDER = order;
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (select.length > 0) params.SELECT = select;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				return await listAll.call(this, 'bizproc.task.list', params, { limit, itemIndex });
			},
		},
		{
			value: 'complete',
			name: 'Complete',
			action: 'Complete a business process task',
			description:
				'Answer a task of a running process for the webhook user: approve, reject or acknowledge, with a comment',
			properties: [
				numberProperty('Task ID', 'taskId', 'ID of the task, as Get Many returns it'),
				{
					displayName: 'Answer',
					name: 'status',
					type: 'options',
					default: 1,
					options: [
						{
							name: 'Acknowledged',
							value: 3,
							description: 'Acknowledge a notice, or answer a request for information',
						},
						{ name: 'Cancel', value: 4, description: 'Refuse a request for information that allows refusing' },
						{ name: 'No', value: 2, description: 'Reject. Only an approval task takes it.' },
						{ name: 'Yes', value: 1, description: 'Approve. Only an approval task takes it.' },
					],
					description:
						'What to answer. Which answers a task takes depends on its kind: approval takes Yes and No, a notice takes Acknowledged, a request for information takes Acknowledged and sometimes Cancel.',
				},
				{
					displayName: 'Comment',
					name: 'comment',
					type: 'string',
					typeOptions: { rows: 3 },
					default: '',
					description: 'Comment shown in the process log next to the answer; some tasks require one',
				},
				{
					displayName: 'Fields (JSON)',
					name: 'fieldsJson',
					type: 'json',
					default: '{}',
					description:
						'Values for a task that asks for additional information, by field code, e.g. {"amount": 1000}. A plain approval needs none.',
				},
			],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const status = Number(this.getNodeParameter('status', itemIndex, 1));
				const comment = String(this.getNodeParameter('comment', itemIndex, '')).trim();
				const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});

				const params: IDataObject = { TASK_ID: taskId, STATUS: status };
				if (comment !== '') params.COMMENT = comment;
				if (Object.keys(fields).length > 0) params.FIELDS = fields;

				const body = await bitrix24Request.call(this, 'bizproc.task.complete', params, { itemIndex });
				return { taskId, status, completed: body.result === true };
			},
		},
		{
			value: 'delegate',
			name: 'Delegate',
			action: 'Delegate business process tasks',
			description: 'Hand tasks of running processes from one person to another, several at once',
			properties: [
				{
					displayName: 'Task IDs',
					name: 'taskIds',
					type: 'string',
					required: true,
					default: '',
					placeholder: '120, 121',
					description: 'IDs of the tasks to hand over, comma-separated',
				},
				numberProperty('From User ID', 'fromUserId', 'Who holds the tasks now'),
				numberProperty('To User ID', 'toUserId', 'Who gets them'),
			],
			async execute(itemIndex) {
				const taskIds = idList(this, this.getNodeParameter('taskIds', itemIndex, ''), 'Task IDs', itemIndex);
				if (taskIds.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Task IDs is empty', { itemIndex });
				}
				const fromUserId = positiveInt(this, 'fromUserId', itemIndex, 'From User ID');
				const toUserId = positiveInt(this, 'toUserId', itemIndex, 'To User ID');

				const body = await bitrix24Request.call(
					this,
					'bizproc.task.delegate',
					{ TASK_IDS: taskIds, FROM_USER_ID: fromUserId, TO_USER_ID: toUserId },
					{ itemIndex },
				);
				return { taskIds, fromUserId, toUserId, delegated: body.result === true };
			},
		},
	],
};
