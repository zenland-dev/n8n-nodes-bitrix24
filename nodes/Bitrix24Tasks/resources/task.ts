import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, orderJsonProperty, returnAllProperties, selectProperty, stringList } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, optionalInt, taskIdProperty, yn } from '../shared/helpers';

const PRIORITIES = [
	{ name: 'High', value: '2' },
	{ name: 'Low', value: '0' },
	{ name: 'Medium', value: '1' },
];

const STATUSES = [
	{ name: 'Awaiting Control', value: 4 },
	{ name: 'Completed', value: 5 },
	{ name: 'Declined', value: 7 },
	{ name: 'Deferred', value: 6 },
	{ name: 'In Progress', value: 3 },
	{ name: 'Pending', value: 2 },
];

function byDisplayName(a: INodeProperties, b: INodeProperties): number {
	return a.displayName.localeCompare(b.displayName);
}

/** The fields a task can be created or changed with. Title and responsible are separate on Create. */
function taskFieldOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Accomplice User IDs', name: 'accomplices', type: 'string', default: '', placeholder: '12, 34', description: 'Comma-separated IDs of users who help with the task. On Update the list replaces the current one.' },
		{ displayName: 'Add to Report', name: 'addInReport', type: 'boolean', default: false, description: 'Whether the task counts in the work report' },
		{ displayName: 'Allow Changing Deadline', name: 'allowChangeDeadline', type: 'boolean', default: false, description: 'Whether the responsible user may move the deadline' },
		{ displayName: 'Allow Time Tracking', name: 'allowTimeTracking', type: 'boolean', default: false, description: 'Whether time spent on the task is tracked' },
		{ displayName: 'Auditor User IDs', name: 'auditors', type: 'string', default: '', placeholder: '12, 34', description: 'Comma-separated IDs of users who observe the task. On Update the list replaces the current one.' },
		{ displayName: 'Complete With Subtasks', name: 'autocompleteSubtasks', type: 'boolean', default: false, description: 'Whether the task completes itself when all subtasks are completed, and reopens with them' },
		{ displayName: 'Created By User ID', name: 'createdBy', type: 'number', default: 0, description: 'Creator of the task. Defaults to the user the webhook acts as.' },
		{ displayName: 'CRM Records', name: 'crmRecords', type: 'string', default: '', placeholder: 'D_10, C_7, T412_3', description: 'Comma-separated CRM records with a type prefix: L_ lead, D_ deal, C_ contact, CO_ company, T&lt;hex type&gt;_ smart process' },
		{ displayName: 'Deadline', name: 'deadline', type: 'dateTime', default: '' },
		{ displayName: 'Deadline From Subtasks', name: 'deadlineFromSubtasks', type: 'boolean', default: false, description: 'Whether the task dates follow the dates of its subtasks' },
		{ displayName: 'Depends On Task IDs', name: 'dependsOn', type: 'string', default: '', placeholder: '101, 102', description: 'Comma-separated IDs of tasks this one depends on' },
		{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'Task text; BB codes such as [B]bold[/B] are allowed' },
		{ displayName: 'Drive File IDs', name: 'files', type: 'string', default: '', placeholder: '428, 345', description: 'Comma-separated IDs of Bitrix24 Drive files to attach. On Update the list replaces the current one.' },
		{ displayName: 'Estimated Time (Seconds)', name: 'timeEstimate', type: 'number', default: 0, description: 'Time planned for the task, in seconds' },
		{ displayName: 'External ID', name: 'xmlId', type: 'string', default: '', description: 'Your own identifier, for finding the task again from another system' },
		{ displayName: 'Flow ID', name: 'flowId', type: 'number', default: 0, description: 'Put the task into a flow, which picks the responsible user itself' },
		{
			displayName: 'Group Name or ID',
			name: 'groupId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getWorkgroups' },
			default: '',
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			hint: 'Workgroup, project or scrum the task belongs to. 0 takes it out of any group.',
		},
		{ displayName: 'Match Work Time', name: 'matchWorkTime', type: 'boolean', default: false, description: 'Whether deadlines skip weekends and holidays' },
		{ displayName: 'Parent Task ID', name: 'parentId', type: 'number', default: 0, description: 'Makes this a subtask. 0 on Update detaches it.' },
		{ displayName: 'Planned End', name: 'endDatePlan', type: 'dateTime', default: '', description: 'Set together with Planned Start' },
		{ displayName: 'Planned Start', name: 'startDatePlan', type: 'dateTime', default: '', description: 'Set together with Planned End' },
		{ displayName: 'Priority', name: 'priority', type: 'options', default: '1', options: PRIORITIES },
		{ displayName: 'Require Result', name: 'requireResult', type: 'boolean', default: false, description: 'Whether the task cannot be completed until a result is added' },
		{ displayName: 'Stage ID', name: 'stageId', type: 'number', default: 0, description: 'Kanban stage of the group, or of My Plan without a group. Kanban Stage → Get Many lists them.' },
		{ displayName: 'Tags', name: 'tags', type: 'string', default: '', placeholder: 'urgent, client', description: 'Comma-separated tags' },
		{ displayName: 'Task Control', name: 'taskControl', type: 'boolean', default: false, description: 'Whether the creator has to accept the work before the task counts as completed' },
	];
	if (forUpdate) {
		options.push(
			{ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', default: 0, description: 'Reassign the task to another user' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		);
	}
	return options.sort(byDisplayName);
}

const customFields: INodeProperties = {
	displayName: 'Custom Fields (JSON)',
	name: 'customFieldsJson',
	type: 'json',
	default: '{}',
	description: 'Custom and any other task fields as a JSON object, merged last, e.g. {"UF_AUTO_123": "value"}. Get Fields lists the names this portal has.',
};

function driveFile(text: string): string {
	return /^n\d+$/.test(text) ? text : `n${text}`;
}

/** Builds `fields` for tasks.task.add and tasks.task.update from the collection the user filled. */
function taskFields(ctx: IExecuteFunctions, o: IDataObject, itemIndex: number): IDataObject {
	const fields: IDataObject = {};
	const has = (key: string): boolean => o[key] !== undefined;
	const date = (key: string, field: string): void => {
		if (has(key)) fields[field] = o[key] as string;
	};

	if (has('title')) fields.TITLE = o.title as string;
	if (has('responsibleId')) fields.RESPONSIBLE_ID = Number(o.responsibleId);
	if (has('description')) fields.DESCRIPTION = o.description as string;
	date('deadline', 'DEADLINE');
	date('startDatePlan', 'START_DATE_PLAN');
	date('endDatePlan', 'END_DATE_PLAN');
	if (has('priority')) fields.PRIORITY = o.priority as string;
	if (has('groupId')) fields.GROUP_ID = Number(o.groupId) || 0;
	if (has('parentId')) fields.PARENT_ID = Number(o.parentId) || 0;
	if (has('stageId')) fields.STAGE_ID = Number(o.stageId) || 0;
	if (optionalInt(o.createdBy) !== undefined) fields.CREATED_BY = Number(o.createdBy);
	if (optionalInt(o.flowId) !== undefined) fields.FLOW_ID = Number(o.flowId);
	if (has('timeEstimate')) fields.TIME_ESTIMATE = Number(o.timeEstimate) || 0;
	if (has('xmlId')) fields.XML_ID = o.xmlId as string;
	if (has('accomplices')) fields.ACCOMPLICES = idList(ctx, o.accomplices, 'Accomplice User IDs', itemIndex);
	if (has('auditors')) fields.AUDITORS = idList(ctx, o.auditors, 'Auditor User IDs', itemIndex);
	if (has('dependsOn')) fields.DEPENDS_ON = idList(ctx, o.dependsOn, 'Depends On Task IDs', itemIndex);
	if (has('tags')) fields.TAGS = stringList(o.tags);
	if (has('crmRecords')) fields.UF_CRM_TASK = stringList(o.crmRecords).map((r) => r.toUpperCase());
	if (has('files')) fields.UF_TASK_WEBDAV_FILES = stringList(o.files).map(driveFile);
	for (const [key, field] of [
		['allowChangeDeadline', 'ALLOW_CHANGE_DEADLINE'],
		['allowTimeTracking', 'ALLOW_TIME_TRACKING'],
		['taskControl', 'TASK_CONTROL'],
		['matchWorkTime', 'MATCH_WORK_TIME'],
		['addInReport', 'ADD_IN_REPORT'],
	] as const) {
		if (has(key)) fields[field] = yn(o[key]);
	}

	// Three task options travel as coded pairs rather than as fields.
	const se: IDataObject[] = [];
	for (const [key, code] of [
		['deadlineFromSubtasks', 1],
		['autocompleteSubtasks', 2],
		['requireResult', 3],
	] as const) {
		if (has(key)) se.push({ CODE: code, VALUE: yn(o[key]) });
	}
	if (se.length > 0) fields.SE_PARAMETER = se;

	return { ...fields, ...jsonParameter<IDataObject>(ctx, 'customFieldsJson', itemIndex, {}) };
}

/** Actions that take a task ID, change something and answer with the task. */
function taskAction(
	value: string,
	name: string,
	action: string,
	description: string,
	method: string,
	idKey: 'taskId' | 'id' = 'taskId',
): Operation {
	return {
		value,
		name,
		action,
		description,
		properties: [taskIdProperty],
		async execute(itemIndex) {
			const id = positiveInt(this, 'taskId', itemIndex, 'Task ID');
			const body = await bitrix24Request.call(this, method, { [idKey]: id }, { itemIndex });
			const result = body.result;
			if (result !== null && typeof result === 'object' && !Array.isArray(result) && 'task' in (result as IDataObject)) {
				const task = (result as IDataObject).task;
				return task !== null && typeof task === 'object' ? (task as IDataObject) : { id, result: task as boolean };
			}
			return { id, result: result as boolean };
		},
	};
}

export const taskResource: Resource = {
	value: 'task',
	name: 'Task',
	description: 'Tasks: create, find, change status, assign, watch',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a task',
			description: 'Create a task. Bitrix24 notifies the responsible user, accomplices and auditors, like a person creating it would.',
			properties: [
				{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '' },
				numberProperty('Responsible User ID', 'responsibleId', 'User who does the task. Required unless Flow ID is set, in which case the flow assigns someone.', false),
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: taskFieldOptions(false) },
				customFields,
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields = taskFields(this, o, itemIndex);
				fields.TITLE = this.getNodeParameter('title', itemIndex) as string;
				const responsible = optionalInt(this.getNodeParameter('responsibleId', itemIndex, 0));
				if (responsible !== undefined) fields.RESPONSIBLE_ID = responsible;
				const body = await bitrix24Request.call(this, 'tasks.task.add', { fields }, { itemIndex });
				return rows(body.result, 'task');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a task',
			description: 'Retrieve one task by ID, with its chat ID, participants and allowed actions',
			properties: [taskIdProperty, selectProperty('ID, TITLE, STATUS, DEADLINE, UF_CRM_TASK')],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const params: IDataObject = { taskId };
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (select.length > 0) params.select = select;
				const body = await bitrix24Request.call(this, 'tasks.task.get', params, { itemIndex });
				// A missing task, or one the webhook user may not see, comes back as an empty array.
				if (Array.isArray(body.result) && body.result.length === 0) {
					throw new NodeOperationError(this.getNode(), `Task ${taskId} was not found, or the webhook user cannot see it`, { itemIndex });
				}
				return rows(body.result, 'task');
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many tasks',
			description: 'List tasks by responsible user, group, status, deadline, CRM record and more',
			properties: [
				...returnAllProperties('tasks'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Accomplice User ID', name: 'accomplice', type: 'number', default: 0 },
						{ displayName: 'Auditor User ID', name: 'auditor', type: 'number', default: 0 },
						{ displayName: 'Changed After', name: 'changedAfter', type: 'dateTime', default: '' },
						{ displayName: 'Closed After', name: 'closedAfter', type: 'dateTime', default: '' },
						{ displayName: 'Closed Before', name: 'closedBefore', type: 'dateTime', default: '' },
						{ displayName: 'Created After', name: 'createdAfter', type: 'dateTime', default: '' },
						{ displayName: 'Created Before', name: 'createdBefore', type: 'dateTime', default: '' },
						{ displayName: 'Created By User ID', name: 'createdBy', type: 'number', default: 0 },
						{ displayName: 'CRM Record', name: 'crmRecord', type: 'string', default: '', placeholder: 'D_10', description: 'Only tasks linked to this CRM record, written with its type prefix' },
						{ displayName: 'Deadline After', name: 'deadlineAfter', type: 'dateTime', default: '' },
						{ displayName: 'Deadline Before', name: 'deadlineBefore', type: 'dateTime', default: '' },
						{
							displayName: 'Group Name or ID',
							name: 'groupId',
							type: 'options',
							typeOptions: { loadOptionsMethod: 'getWorkgroups' },
							default: '',
							description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						},
						{ displayName: 'Only Top-Level Tasks', name: 'onlyRoot', type: 'boolean', default: true, description: 'Whether to leave out subtasks whose parent the webhook user can see' },
						{ displayName: 'Parent Task ID', name: 'parentId', type: 'number', default: 0 },
						{ displayName: 'Priority', name: 'priority', type: 'options', default: '2', options: PRIORITIES },
						{ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', default: 0 },
						{ displayName: 'Stage ID', name: 'stageId', type: 'number', default: 0 },
						{ displayName: 'Status', name: 'status', type: 'multiOptions', default: [], options: STATUSES },
						{ displayName: 'Tag', name: 'tag', type: 'string', default: '' },
						{ displayName: 'Title Contains', name: 'title', type: 'string', default: '' },
					],
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description: 'Extra filter merged over Filters, e.g. {"!REAL_STATUS": 5, "&gt;=DEADLINE": "2026-10-01"}. Prefix a field with ! &lt; &lt;= &gt; &gt;=.',
				},
				orderJsonProperty('{"DEADLINE": "asc"}'),
				selectProperty('ID, TITLE, STATUS, DEADLINE, RESPONSIBLE_ID'),
				{
					displayName: 'Options',
					name: 'listOptions',
					type: 'collection',
					placeholder: 'Add Option',
					default: {},
					options: [
						{ displayName: 'Include Description as HTML', name: 'withParsedDescription', type: 'boolean', default: true, description: 'Whether to add parsedDescription, the description with BB codes turned into HTML' },
						{ displayName: 'Include Result Info', name: 'withResultInfo', type: 'boolean', default: true, description: 'Whether to add whether each task requires a result and has one' },
						{ displayName: 'Include Timer Info', name: 'withTimerInfo', type: 'boolean', default: true, description: 'Whether to add the time elapsed and whether the timer is running' },
					],
				},
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter: IDataObject = {};
				const set = (key: string, value: unknown): void => {
					if (value !== undefined && value !== '' && value !== null) filter[key] = value;
				};
				set('RESPONSIBLE_ID', optionalInt(f.responsibleId));
				set('CREATED_BY', optionalInt(f.createdBy));
				set('ACCOMPLICE', optionalInt(f.accomplice));
				set('AUDITOR', optionalInt(f.auditor));
				if (f.groupId !== undefined && f.groupId !== '') filter.GROUP_ID = Number(f.groupId);
				set('PARENT_ID', optionalInt(f.parentId));
				if (f.stageId !== undefined) filter.STAGE_ID = Number(f.stageId) || 0;
				set('PRIORITY', f.priority);
				set('TAG', f.tag);
				if (typeof f.title === 'string' && f.title !== '') filter['%TITLE'] = f.title;
				if (typeof f.crmRecord === 'string' && f.crmRecord !== '') filter.UF_CRM_TASK = f.crmRecord.toUpperCase();
				if (Array.isArray(f.status) && f.status.length > 0) filter.REAL_STATUS = f.status;
				if (f.onlyRoot === true) filter.ONLY_ROOT_TASKS = 'Y';
				set('>=CREATED_DATE', f.createdAfter);
				set('<=CREATED_DATE', f.createdBefore);
				set('>=CHANGED_DATE', f.changedAfter);
				set('>=CLOSED_DATE', f.closedAfter);
				set('<=CLOSED_DATE', f.closedBefore);
				set('>=DEADLINE', f.deadlineAfter);
				set('<=DEADLINE', f.deadlineBefore);

				const params: IDataObject = { filter: { ...filter, ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) } };
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.order = order;
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (select.length > 0) params.select = select.includes('ID') || select.includes('*') ? select : ['ID', ...select];
				const o = (this.getNodeParameter('listOptions', itemIndex, {}) ?? {}) as IDataObject;
				const extra: IDataObject = {};
				if (o.withResultInfo === true) extra.WITH_RESULT_INFO = 'Y';
				if (o.withTimerInfo === true) extra.WITH_TIMER_INFO = 'Y';
				if (o.withParsedDescription === true) extra.WITH_PARSED_DESCRIPTION = 'Y';
				if (Object.keys(extra).length > 0) params.params = extra;

				return await listAll.call(this, 'tasks.task.list', params, { itemsKey: 'tasks', idField: 'ID', rowIdKey: 'id', limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a task',
			description: 'Change fields of a task; fields not given stay as they are',
			properties: [
				taskIdProperty,
				{ displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: taskFieldOptions(true) },
				customFields,
			],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields = taskFields(this, o, itemIndex);
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				}
				const body = await bitrix24Request.call(this, 'tasks.task.update', { taskId, fields }, { itemIndex });
				return rows(body.result, 'task');
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a task',
			description: 'Delete a task',
			properties: [taskIdProperty],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				await bitrix24Request.call(this, 'tasks.task.delete', { taskId }, { itemIndex });
				return { id: taskId, deleted: true };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get task fields',
			description: 'Describe every task field of this portal, custom fields included: type, title, allowed values',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.task.getFields', {}, { itemIndex });
				const result = (body.result ?? {}) as IDataObject;
				const fields = (result.fields ?? result) as IDataObject;
				return Object.entries(fields).map(([name, meta]) => (meta !== null && typeof meta === 'object' ? { name, ...(meta as IDataObject) } : { name, value: meta as string }));
			},
		},
		{
			value: 'delegate',
			name: 'Delegate',
			action: 'Delegate a task',
			description: 'Hand a task over to another responsible user, as the Delegate button does',
			properties: [taskIdProperty, numberProperty('User ID', 'userId', 'User who takes the task over')],
			async execute(itemIndex) {
				const params = { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID'), userId: positiveInt(this, 'userId', itemIndex, 'User ID') };
				const body = await bitrix24Request.call(this, 'tasks.task.delegate', params, { itemIndex });
				return rows(body.result, 'task');
			},
		},
		taskAction('start', 'Start', 'Start a task', 'Move a task to In Progress', 'tasks.task.start'),
		taskAction('pause', 'Pause', 'Pause a task', 'Stop work on a task and return it to Pending', 'tasks.task.pause'),
		taskAction('defer', 'Defer', 'Defer a task', 'Move a task to Deferred', 'tasks.task.defer'),
		taskAction('complete', 'Complete', 'Complete a task', 'Mark a task completed. With Task Control on, it goes to the creator for approval first.', 'tasks.task.complete'),
		taskAction('renew', 'Reopen', 'Reopen a task', 'Return a completed or deferred task to work', 'tasks.task.renew'),
		taskAction('approve', 'Approve', 'Approve a task', 'Accept the work on a task that awaits control; it becomes completed', 'tasks.task.approve'),
		taskAction('disapprove', 'Return for Rework', 'Return a task for rework', 'Reject the work on a task that awaits control and send it back to the responsible user', 'tasks.task.disapprove'),
		taskAction('startWatching', 'Start Watching', 'Watch a task', 'Add the webhook user to the auditors of a task', 'tasks.task.startwatch'),
		taskAction('stopWatching', 'Stop Watching', 'Stop watching a task', 'Remove the webhook user from the auditors of a task', 'tasks.task.stopwatch'),
		taskAction('addToFavorites', 'Add to Favorites', 'Add a task to favorites', 'Add a task to the favorites of the webhook user', 'tasks.task.favorite.add'),
		taskAction('removeFromFavorites', 'Remove From Favorites', 'Remove a task from favorites', 'Remove a task from the favorites of the webhook user', 'tasks.task.favorite.remove'),
		taskAction('pin', 'Pin', 'Pin a task', 'Pin a task to the top of the task list of the webhook user', 'tasks.task.pin', 'id'),
		taskAction('unpin', 'Unpin', 'Unpin a task', 'Release a pinned task back into the list', 'tasks.task.unpin', 'id'),
		taskAction('mute', 'Mute', 'Mute a task', 'Stop notifications about a task for the webhook user', 'tasks.task.mute', 'id'),
		taskAction('unmute', 'Unmute', 'Unmute a task', 'Turn notifications about a task back on for the webhook user', 'tasks.task.unmute', 'id'),
		{
			value: 'addComment',
			name: 'Add Comment',
			action: 'Add a comment to a task',
			description: 'Post a message into the task chat, where the new task card keeps its comments. The author is the webhook user.',
			properties: [taskIdProperty, { displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 4 }, required: true, default: '' }],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const text = this.getNodeParameter('text', itemIndex) as string;
				await bitrix24Request.call(this, 'tasks.task.chat.message.send', { fields: { taskId, text } }, { v3: true, itemIndex });
				return { taskId, sent: true };
			},
		},
		{
			value: 'getHistory',
			name: 'Get History',
			action: 'Get the history of a task',
			description: 'List every recorded change of a task: status, deadline, responsible, checklist, comments',
			properties: [
				taskIdProperty,
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description: 'Only some kinds of change, e.g. {"FIELD": "STATUS"} or {"FIELD": "DEADLINE"}',
				},
			],
			async execute(itemIndex) {
				const params: IDataObject = { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID') };
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.filter = filter;
				const body = await bitrix24Request.call(this, 'tasks.task.history.list', params, { itemIndex });
				return rows(body.result, 'list');
			},
		},
		{
			value: 'getCounters',
			name: 'Get Counters',
			action: 'Get the task counters of a user',
			description: 'Read how many tasks of a user are overdue and how many have unread comments',
			properties: [
				numberProperty('User ID', 'userId', 'User to count for. 0 means the webhook user.', false),
				{
					displayName: 'Group Name or ID',
					name: 'groupId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getWorkgroups' },
					default: '',
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					hint: 'Count only inside one group. Leave empty for all.',
				},
				{
					displayName: 'Role',
					name: 'role',
					type: 'options',
					default: 'view_all',
					options: [
						{ name: 'Accomplice', value: 'view_role_accomplice' },
						{ name: 'All Roles', value: 'view_all' },
						{ name: 'Auditor', value: 'view_role_auditor' },
						{ name: 'Creator', value: 'view_role_originator' },
						{ name: 'Responsible', value: 'view_role_responsible' },
					],
				},
			],
			async execute(itemIndex) {
				const params: IDataObject = { type: this.getNodeParameter('role', itemIndex) as string };
				const userId = optionalInt(this.getNodeParameter('userId', itemIndex, 0));
				if (userId !== undefined) params.userId = userId;
				const groupId = optionalInt(this.getNodeParameter('groupId', itemIndex, ''));
				if (groupId !== undefined) params.groupId = groupId;
				const body = await bitrix24Request.call(this, 'tasks.task.counters.get', params, { itemIndex });
				const counters: IDataObject = {};
				for (const [name, value] of Object.entries((body.result ?? {}) as IDataObject)) {
					counters[name] = value !== null && typeof value === 'object' ? ((value as IDataObject).counter as number) : (value as number);
				}
				return counters;
			},
		},
		{
			value: 'checkAccess',
			name: 'Check Access',
			action: 'Check what users may do with a task',
			description: 'List the actions each user may take on a task: edit, complete, delegate, delete and the rest',
			properties: [
				taskIdProperty,
				{ displayName: 'User IDs', name: 'userIds', type: 'string', default: '', placeholder: '12, 34', description: 'Comma-separated users to check. Leave empty for the webhook user.' },
			],
			async execute(itemIndex) {
				const params: IDataObject = { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID') };
				const users = idList(this, this.getNodeParameter('userIds', itemIndex, ''), 'User IDs', itemIndex);
				if (users.length > 0) params.users = users;
				const body = await bitrix24Request.call(this, 'tasks.task.getaccess', params, { itemIndex });
				const allowed = ((body.result ?? {}) as IDataObject).allowedActions;
				if (allowed === null || typeof allowed !== 'object' || Array.isArray(allowed)) return [];
				return Object.entries(allowed as IDataObject).map(([userId, actions]) => ({ userId: Number(userId), ...(actions as IDataObject) }));
			},
		},
		{
			value: 'attachFile',
			name: 'Attach File',
			action: 'Attach a Drive file to a task',
			description: 'Attach a file that is already on Bitrix24 Drive to a task',
			properties: [taskIdProperty, numberProperty('Drive File ID', 'fileId', 'ID of the file on Bitrix24 Drive, as disk.folder.uploadfile or disk.folder.getchildren return it')],
			async execute(itemIndex) {
				const params = { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID'), fileId: positiveInt(this, 'fileId', itemIndex, 'Drive File ID') };
				const body = await bitrix24Request.call(this, 'tasks.task.files.attach', params, { itemIndex });
				return { ...params, ...(rows(body.result) as IDataObject) };
			},
		},
		{
			value: 'getDailyPlan',
			name: 'Get Daily Plan',
			action: 'Get the daily plan',
			description: 'List the IDs of tasks the webhook user put into their plan for the day',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.planner.getlist', {}, { itemIndex });
				return (Array.isArray(body.result) ? body.result : []).map((id) => ({ taskId: Number(id) }));
			},
		},
	],
};
