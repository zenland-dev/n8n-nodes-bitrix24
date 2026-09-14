import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeProperty, numberProperty, positiveInt, rows } from '../shared/props';

const owner: INodeProperties[] = [
	entityTypeProperty('Type of the CRM record the activity belongs to'),
	numberProperty('Record ID', 'entityId', 'ID of the lead, deal, contact or other record'),
];

const activityId = numberProperty('Activity ID', 'activityId', 'ID of the activity');

function ownerParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return {
		ownerTypeId: positiveInt(ctx, 'entityTypeId', itemIndex, 'Entity type'),
		ownerId: positiveInt(ctx, 'entityId', itemIndex, 'Record ID'),
	};
}

const COLORS = [
	{ name: 'Default', value: '' },
	...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `Color ${n}`, value: String(n) })),
];

const todoOptions: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'todoOptions',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	options: [
		{ displayName: 'Color', name: 'colorId', type: 'options', default: '', options: COLORS, description: 'Colour of the activity in the timeline' },
		{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
		{ displayName: 'Parent Activity ID', name: 'parentActivityId', type: 'number', default: 0, description: 'Activity this one follows up on' },
		{
			displayName: 'Reminders (Minutes Before)',
			name: 'pingOffsets',
			type: 'string',
			default: '',
			placeholder: '0, 15, 60',
			description: 'Comma-separated minutes before the deadline to remind, 0 meaning at the deadline',
		},
		{ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', default: 0, description: 'Defaults to the user the webhook acts as' },
		{ displayName: 'Title', name: 'title', type: 'string', default: '' },
	],
};

function todoBody(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const o = (ctx.getNodeParameter('todoOptions', itemIndex, {}) ?? {}) as IDataObject;
	const body = compact({
		deadline: ctx.getNodeParameter('deadline', itemIndex) as string,
		title: o.title,
		description: o.description,
		responsibleId: Number(o.responsibleId) || undefined,
		parentActivityId: Number(o.parentActivityId) || undefined,
		colorId: o.colorId,
	});
	const pings = stringList(o.pingOffsets).map(Number).filter(Number.isFinite);
	if (pings.length > 0) body.pingOffsets = pings;
	return body;
}

const deadline: INodeProperties = {
	displayName: 'Deadline',
	name: 'deadline',
	type: 'dateTime',
	required: true,
	default: '',
};

export const activityResource: Resource = {
	value: 'activity',
	name: 'Activity',
	description: 'To-dos, calls, meetings and e-mails in the timeline of a record',
	operations: [
		{
			value: 'createTodo',
			name: 'Create To-Do',
			action: 'Create a to-do activity',
			description: 'Add a to-do with a deadline to a record; the responsible user is reminded and it shows in their activity counter',
			properties: [...owner, deadline, todoOptions],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.activity.todo.add', { ...ownerParams(this, itemIndex), ...todoBody(this, itemIndex) }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'updateTodo',
			name: 'Update To-Do',
			action: 'Update a to-do activity',
			description: 'Rewrite a to-do: deadline plus any of title, description, responsible, reminders and colour',
			properties: [activityId, ...owner, deadline, todoOptions],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'crm.activity.todo.update',
					{ id: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), ...ownerParams(this, itemIndex), ...todoBody(this, itemIndex) },
					{ itemIndex },
				);
				return rows(body.result);
			},
		},
		{
			value: 'setDeadline',
			name: 'Set Deadline',
			action: 'Move the deadline of a to-do',
			description: 'Change only the deadline of a to-do',
			properties: [activityId, ...owner, deadline],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), ...ownerParams(this, itemIndex), value: this.getNodeParameter('deadline', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'crm.activity.todo.updateDeadline', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'setDescription',
			name: 'Set Description',
			action: 'Change the description of a to-do',
			description: 'Change only the description of a to-do',
			properties: [activityId, ...owner, { displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, required: true, default: '' }],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), ...ownerParams(this, itemIndex), value: this.getNodeParameter('description', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'crm.activity.todo.updateDescription', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'setResponsible',
			name: 'Set Responsible',
			action: 'Reassign a to-do',
			description: 'Hand a to-do over to another user',
			properties: [activityId, ...owner, numberProperty('Responsible User ID', 'responsibleId', 'User who becomes responsible')],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), ...ownerParams(this, itemIndex), responsibleId: positiveInt(this, 'responsibleId', itemIndex, 'Responsible User ID') };
				const body = await bitrix24Request.call(this, 'crm.activity.todo.updateResponsibleUser', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'setColor',
			name: 'Set Color',
			action: 'Change the color of a to-do',
			description: 'Change only the colour a to-do is drawn with in the timeline',
			properties: [activityId, ...owner, { displayName: 'Color', name: 'colorId', type: 'options', default: '1', options: COLORS.slice(1) }],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), ...ownerParams(this, itemIndex), colorId: this.getNodeParameter('colorId', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'crm.activity.todo.updateColor', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'complete',
			name: 'Complete',
			action: 'Mark an activity as done',
			description: 'Mark any activity — to-do, call, meeting, e-mail — as completed, or reopen it',
			properties: [
				activityId,
				{ displayName: 'Completed', name: 'completed', type: 'boolean', default: true, description: 'Whether the activity is done. Turn off to reopen it.' },
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'activityId', itemIndex, 'Activity ID');
				const completed = (this.getNodeParameter('completed', itemIndex) as boolean) ? 'Y' : 'N';
				// crm.activity.update is frozen in favour of the to-do methods, but none of
				// those can complete an activity, and it still works for every type.
				await bitrix24Request.call(this, 'crm.activity.update', { id, fields: { COMPLETED: completed } }, { itemIndex });
				return { id, completed: completed === 'Y' };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an activity',
			description: 'Retrieve one activity of any type with its communications',
			properties: [activityId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.activity.get', { id: positiveInt(this, 'activityId', itemIndex, 'Activity ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many activities',
			description: 'List activities of any type, e.g. the open to-dos of a record or a user',
			properties: [
				...returnAllProperties('activities'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Completed', name: 'completed', type: 'boolean', default: false, description: 'Whether to return only completed activities (on) or only open ones (off)' },
						{ displayName: 'Deadline After', name: 'deadlineAfter', type: 'dateTime', default: '' },
						{ displayName: 'Deadline Before', name: 'deadlineBefore', type: 'dateTime', default: '' },
						{ displayName: 'Record ID', name: 'ownerId', type: 'number', default: 0, description: 'Only activities of this record; set Record Type too' },
						{ displayName: 'Record Type ID', name: 'ownerTypeId', type: 'number', default: 2, description: '1 lead, 2 deal, 3 contact, 4 company, 7 quote, 31 invoice, 1000+ smart process' },
						{ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', default: 0 },
					],
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description: 'Extra filter on activity fields, merged over Filters, e.g. {"TYPE_ID": 2, "PROVIDER_ID": "VOXIMPLANT_CALL"}',
				},
				{
					displayName: 'Include Communications and Files',
					name: 'withDetails',
					type: 'boolean',
					default: false,
					description: 'Whether to also return phone numbers, e-mails and files of each activity; slower',
				},
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter = compact({
					OWNER_TYPE_ID: Number(f.ownerId) > 0 ? f.ownerTypeId : undefined,
					OWNER_ID: Number(f.ownerId) || undefined,
					RESPONSIBLE_ID: Number(f.responsibleId) || undefined,
					COMPLETED: f.completed === undefined ? undefined : f.completed ? 'Y' : 'N',
					'>=DEADLINE': f.deadlineAfter,
					'<=DEADLINE': f.deadlineBefore,
				});
				const params: IDataObject = { filter: { ...filter, ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) } };
				if (this.getNodeParameter('withDetails', itemIndex) as boolean) params.select = ['*', 'COMMUNICATIONS', 'FILES'];
				return await listAll.call(this, 'crm.activity.list', params, { idField: 'ID', limit, itemIndex });
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete an activity',
			description: 'Delete an activity from the timeline',
			properties: [activityId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'activityId', itemIndex, 'Activity ID');
				await bitrix24Request.call(this, 'crm.activity.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get activity fields',
			description: 'Describe the fields an activity has, or those of its communications',
			properties: [
				{
					displayName: 'Of',
					name: 'fieldsOf',
					type: 'options',
					default: 'activity',
					options: [
						{ name: 'Activity', value: 'activity' },
						{ name: 'Communication', value: 'communication' },
					],
				},
			],
			async execute(itemIndex) {
				const method = this.getNodeParameter('fieldsOf', itemIndex) === 'communication' ? 'crm.activity.communication.fields' : 'crm.activity.fields';
				const body = await bitrix24Request.call(this, method, {}, { itemIndex });
				return Object.entries((body.result ?? {}) as IDataObject).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
		{
			value: 'getCallTranscript',
			name: 'Get Call Transcript',
			action: 'Get the transcript of a call',
			description: 'Read the speech-to-text transcript of a call activity, when the portal transcribed it',
			properties: [activityId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.activity.call.getTranscript', { activityId: positiveInt(this, 'activityId', itemIndex, 'Activity ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'link',
			name: 'Link to Record',
			action: 'Show an activity in another record',
			description: 'Make an activity also appear in the timeline of another record',
			properties: [activityId, ...owner],
			async execute(itemIndex) {
				const { ownerTypeId, ownerId } = ownerParams(this, itemIndex);
				const params = { activityId: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), entityTypeId: ownerTypeId, entityId: ownerId };
				await bitrix24Request.call(this, 'crm.activity.binding.add', params, { itemIndex });
				return { linked: true, ...params };
			},
		},
		{
			value: 'unlink',
			name: 'Unlink From Record',
			action: 'Remove an activity from a record',
			description: 'Stop an activity appearing in one of the records it is linked to',
			properties: [activityId, ...owner],
			async execute(itemIndex) {
				const { ownerTypeId, ownerId } = ownerParams(this, itemIndex);
				const params = { activityId: positiveInt(this, 'activityId', itemIndex, 'Activity ID'), entityTypeId: ownerTypeId, entityId: ownerId };
				await bitrix24Request.call(this, 'crm.activity.binding.delete', params, { itemIndex });
				return { unlinked: true, ...params };
			},
		},
		{
			value: 'getLinks',
			name: 'Get Links',
			action: 'Get the records an activity is linked to',
			description: 'List every record whose timeline shows this activity',
			properties: [activityId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.activity.binding.list', { activityId: positiveInt(this, 'activityId', itemIndex, 'Activity ID') }, { itemIndex });
				return rows(body.result, 'bindings');
			},
		},
		{
			value: 'move',
			name: 'Move',
			action: 'Move an activity to another record',
			description: 'Move an activity from one record to another',
			properties: [
				activityId,
				entityTypeProperty('Type of the record the activity is in now', 'sourceTypeId', 'From Entity Type Name or ID'),
				numberProperty('From Record ID', 'sourceId', 'ID of the record the activity is in now'),
				entityTypeProperty('Type of the record to move it to', 'targetTypeId', 'To Entity Type Name or ID'),
				numberProperty('To Record ID', 'targetId', 'ID of the record to move it to'),
			],
			async execute(itemIndex) {
				const params = {
					activityId: positiveInt(this, 'activityId', itemIndex, 'Activity ID'),
					sourceEntityTypeId: positiveInt(this, 'sourceTypeId', itemIndex, 'From entity type'),
					sourceEntityId: positiveInt(this, 'sourceId', itemIndex, 'From Record ID'),
					targetEntityTypeId: positiveInt(this, 'targetTypeId', itemIndex, 'To entity type'),
					targetEntityId: positiveInt(this, 'targetId', itemIndex, 'To Record ID'),
				};
				await bitrix24Request.call(this, 'crm.activity.binding.move', params, { itemIndex });
				return { moved: true, ...params };
			},
		},
	],
};
