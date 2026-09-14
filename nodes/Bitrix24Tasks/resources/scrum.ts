import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt, workgroupProperty } from '../shared/helpers';

const scrumGroup = workgroupProperty('groupId', 'Scrum Name or ID', 'A scrum: a project with a scrum master');

function getFieldsOperation(noun: string, method: string): Operation {
	return {
		value: 'getFields',
		name: 'Get Fields',
		action: `Get ${noun} fields`,
		description: `Describe the fields a ${noun} has`,
		async execute(itemIndex) {
			const body = await bitrix24Request.call(this, method, {}, { itemIndex });
			const result = (body.result ?? {}) as IDataObject;
			const fields = (result.fields ?? result) as IDataObject;
			return Object.entries(fields).map(([name, meta]) => (meta !== null && typeof meta === 'object' ? { name, ...(meta as IDataObject) } : { name, value: meta as string }));
		},
	};
}

function byDisplayName(options: INodeProperties[]): INodeProperties[] {
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── Sprints ───────────────────────────────────────────────────────────────

const sprintId = numberProperty('Sprint ID', 'sprintId', 'ID of the sprint');

const SPRINT_STATUSES = [
	{ name: 'Active', value: 'active' },
	{ name: 'Completed', value: 'completed' },
	{ name: 'Planned', value: 'planned' },
];

function sprintOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [{ displayName: 'Sort', name: 'sort', type: 'number', default: 0 }];
	if (forUpdate) {
		options.push(
			{ displayName: 'End', name: 'dateEnd', type: 'dateTime', default: '' },
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{ displayName: 'Start', name: 'dateStart', type: 'dateTime', default: '' },
			{ displayName: 'Status', name: 'status', type: 'options', default: 'planned', options: SPRINT_STATUSES },
		);
	}
	return byDisplayName(options);
}

function sprintFields(o: IDataObject): IDataObject {
	const fields: IDataObject = {};
	if (o.name !== undefined && o.name !== '') fields.name = o.name as string;
	if (o.dateStart) fields.dateStart = o.dateStart as string;
	if (o.dateEnd) fields.dateEnd = o.dateEnd as string;
	if (o.sort !== undefined) fields.sort = Number(o.sort) || 0;
	if (o.status !== undefined) fields.status = o.status as string;
	return fields;
}

export const sprintResource: Resource = {
	value: 'sprint',
	name: 'Scrum Sprint',
	description: 'Sprints of a scrum: planned, started and completed',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a sprint',
			description: 'Add a sprint to a scrum',
			properties: [
				scrumGroup,
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				// Bitrix24 answers "Incorrect dateStart format" without dates and "Incorrect sprint
				// status" without a status (live portal, 14.09.2026), so all three are required.
				{ displayName: 'Start', name: 'dateStart', type: 'dateTime', required: true, default: '' },
				{ displayName: 'End', name: 'dateEnd', type: 'dateTime', required: true, default: '' },
				{ displayName: 'Status', name: 'status', type: 'options', default: 'planned', options: SPRINT_STATUSES },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: sprintOptions(false) },
			],
			async execute(itemIndex) {
				const o = {
					...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject),
					dateStart: this.getNodeParameter('dateStart', itemIndex) as string,
					dateEnd: this.getNodeParameter('dateEnd', itemIndex) as string,
					status: this.getNodeParameter('status', itemIndex) as string,
				};
				const fields = { groupId: positiveInt(this, 'groupId', itemIndex, 'Scrum'), name: this.getNodeParameter('name', itemIndex) as string, ...sprintFields(o) };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.sprint.add', { fields }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a sprint',
			description: 'Retrieve one sprint',
			properties: [sprintId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.sprint.get', { sprintId: positiveInt(this, 'sprintId', itemIndex, 'Sprint ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many sprints',
			description: 'List sprints, of one scrum or all',
			properties: [
				{ ...scrumGroup, required: false, hint: 'Only the sprints of this scrum. Leave empty for all.' },
				...returnAllProperties('sprints'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Extra filter, e.g. {"STATUS": "active"}' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter: IDataObject = {};
				const group = optionalInt(this.getNodeParameter('groupId', itemIndex, ''));
				if (group !== undefined) filter.GROUP_ID = group;
				const params = { filter: { ...filter, ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) } };
				return await listAll.call(this, 'tasks.api.scrum.sprint.list', params, { limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a sprint',
			description: 'Rename a sprint or change its dates, order or status',
			properties: [sprintId, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: sprintOptions(true) }],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'sprintId', itemIndex, 'Sprint ID'), fields: sprintFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject) };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.sprint.update', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a sprint',
			description: 'Delete a sprint',
			properties: [sprintId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'sprintId', itemIndex, 'Sprint ID');
				await bitrix24Request.call(this, 'tasks.api.scrum.sprint.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'start',
			name: 'Start',
			action: 'Start a sprint',
			description: 'Start a planned sprint',
			properties: [sprintId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.sprint.start', { id: positiveInt(this, 'sprintId', itemIndex, 'Sprint ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'completeActive',
			name: 'Complete Active Sprint',
			action: 'Complete the active sprint of a scrum',
			description: 'Complete the running sprint of a scrum; unfinished tasks go back to the backlog',
			properties: [scrumGroup],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.sprint.complete', { id: positiveInt(this, 'groupId', itemIndex, 'Scrum') }, { itemIndex });
				return rows(body.result);
			},
		},
		getFieldsOperation('sprint', 'tasks.api.scrum.sprint.getFields'),
	],
};

// ── Epics ─────────────────────────────────────────────────────────────────

const epicId = numberProperty('Epic ID', 'epicId', 'ID of the epic');

function epicOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Color', name: 'color', type: 'color', default: '#69DAFC' },
		{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
		{ displayName: 'Drive File IDs', name: 'files', type: 'string', default: '', placeholder: '428, 345', description: 'Comma-separated Drive files to attach to the epic' },
	];
	if (forUpdate) options.push({ displayName: 'Name', name: 'name', type: 'string', default: '' });
	return byDisplayName(options);
}

function epicFields(o: IDataObject): IDataObject {
	const fields: IDataObject = {};
	if (o.name !== undefined && o.name !== '') fields.name = o.name as string;
	if (o.description !== undefined) fields.description = o.description as string;
	if (o.color !== undefined) fields.color = o.color as string;
	if (o.files !== undefined) fields.files = stringList(o.files).map((f) => (/^n\d+$/.test(f) ? f : `n${f}`));
	return fields;
}

export const epicResource: Resource = {
	value: 'epic',
	name: 'Scrum Epic',
	description: 'Epics: themes that group backlog tasks of a scrum',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create an epic',
			description: 'Add an epic to a scrum',
			properties: [
				scrumGroup,
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: epicOptions(false) },
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields = { groupId: positiveInt(this, 'groupId', itemIndex, 'Scrum'), name: this.getNodeParameter('name', itemIndex) as string, ...epicFields(o) };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.epic.add', { fields }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an epic',
			description: 'Retrieve one epic',
			properties: [epicId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.epic.get', { id: positiveInt(this, 'epicId', itemIndex, 'Epic ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many epics',
			description: 'List epics, of one scrum or all',
			properties: [
				{ ...scrumGroup, required: false, hint: 'Only the epics of this scrum. Leave empty for all.' },
				...returnAllProperties('epics'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Extra filter, e.g. {"%name": "billing"}' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter: IDataObject = {};
				const group = optionalInt(this.getNodeParameter('groupId', itemIndex, ''));
				if (group !== undefined) filter.groupId = group;
				const params = { filter: { ...filter, ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) } };
				return await listAll.call(this, 'tasks.api.scrum.epic.list', params, { limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update an epic',
			description: 'Rename an epic or change its description, colour or files',
			properties: [epicId, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: epicOptions(true) }],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'epicId', itemIndex, 'Epic ID'), fields: epicFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject) };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.epic.update', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete an epic',
			description: 'Delete an epic; its tasks stay in the backlog',
			properties: [epicId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'epicId', itemIndex, 'Epic ID');
				await bitrix24Request.call(this, 'tasks.api.scrum.epic.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		getFieldsOperation('epic', 'tasks.api.scrum.epic.getFields'),
	],
};

// ── Backlog ───────────────────────────────────────────────────────────────

const backlogId = numberProperty('Backlog ID', 'backlogId', 'ID of the backlog, as Get returns it');

export const backlogResource: Resource = {
	value: 'backlog',
	name: 'Scrum Backlog',
	description: 'The backlog of a scrum, where tasks wait for a sprint',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a backlog',
			description: 'Give a scrum its backlog',
			properties: [scrumGroup, numberProperty('Created By User ID', 'createdBy', 'User recorded as having created the backlog')],
			async execute(itemIndex) {
				const fields = { groupId: positiveInt(this, 'groupId', itemIndex, 'Scrum'), createdBy: positiveInt(this, 'createdBy', itemIndex, 'Created By User ID') };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.backlog.add', { fields }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get the backlog of a scrum',
			description: 'Retrieve the backlog of a scrum, to learn its ID',
			properties: [scrumGroup],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.backlog.get', { id: positiveInt(this, 'groupId', itemIndex, 'Scrum') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a backlog',
			description: 'Move a backlog to another scrum or change who is recorded as its author or editor',
			properties: [
				backlogId,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Created By User ID', name: 'createdBy', type: 'number', default: 0 },
						{ displayName: 'Modified By User ID', name: 'modifiedBy', type: 'number', default: 0 },
						{ displayName: 'Scrum ID', name: 'groupId', type: 'number', default: 0 },
					],
				},
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				for (const key of ['groupId', 'createdBy', 'modifiedBy']) if (optionalInt(o[key]) !== undefined) fields[key] = Number(o[key]);
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.backlog.update', { id: positiveInt(this, 'backlogId', itemIndex, 'Backlog ID'), fields }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a backlog',
			description: 'Delete the backlog of a scrum',
			properties: [backlogId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'backlogId', itemIndex, 'Backlog ID');
				await bitrix24Request.call(this, 'tasks.api.scrum.backlog.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		getFieldsOperation('backlog', 'tasks.api.scrum.backlog.getFields'),
	],
};

// ── Sprint kanban ─────────────────────────────────────────────────────────

const scrumStageId = numberProperty('Stage ID', 'stageId', 'ID of the sprint kanban stage');
const sprintIdRequired = numberProperty('Sprint ID', 'sprintId', 'ID of an active sprint');

const STAGE_TYPES = [
	{ name: 'Finish', value: 'FINISH' },
	{ name: 'In Progress', value: 'WORK' },
	{ name: 'New', value: 'NEW' },
];

function scrumStageOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Color', name: 'color', type: 'color', default: '#00C4FB' },
		{ displayName: 'Sort', name: 'sort', type: 'number', default: 100, description: 'Position of the column; must be a multiple of 100' },
		{ displayName: 'Type', name: 'type', type: 'options', default: 'WORK', options: STAGE_TYPES, description: 'A sprint kanban needs one New and one Finish stage' },
	];
	if (forUpdate) {
		options.push({ displayName: 'Name', name: 'name', type: 'string', default: '' }, { displayName: 'Sprint ID', name: 'sprintId', type: 'number', default: 0 });
	}
	return byDisplayName(options);
}

function scrumStageFields(o: IDataObject): IDataObject {
	const fields: IDataObject = {};
	if (o.name !== undefined && o.name !== '') fields.name = o.name as string;
	if (o.type !== undefined) fields.type = o.type as string;
	if (o.sort !== undefined) fields.sort = Number(o.sort) || 0;
	if (o.color !== undefined) fields.color = String(o.color).replace(/^#/, '').toUpperCase();
	if (optionalInt(o.sprintId) !== undefined) fields.sprintId = Number(o.sprintId);
	return fields;
}

function sprintTask(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return { sprintId: positiveInt(ctx, 'sprintId', itemIndex, 'Sprint ID'), taskId: positiveInt(ctx, 'taskId', itemIndex, 'Task ID') };
}

export const scrumStageResource: Resource = {
	value: 'scrumStage',
	name: 'Scrum Kanban Stage',
	description: 'Columns of the kanban of an active sprint, and the tasks on it',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a sprint kanban stage',
			description: 'Add a column to the kanban of an active sprint',
			properties: [
				sprintIdRequired,
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: scrumStageOptions(false) },
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields = { sprintId: positiveInt(this, 'sprintId', itemIndex, 'Sprint ID'), name: this.getNodeParameter('name', itemIndex) as string, ...scrumStageFields(o) };
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.kanban.addStage', { fields }, { itemIndex });
				return { id: body.result as number, ...fields };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the kanban stages of a sprint',
			description: 'List the columns of the kanban of a sprint',
			properties: [sprintIdRequired],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.kanban.getStages', { sprintId: positiveInt(this, 'sprintId', itemIndex, 'Sprint ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a sprint kanban stage',
			description: 'Rename, recolour, reorder or retype a sprint kanban column',
			properties: [scrumStageId, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: scrumStageOptions(true) }],
			async execute(itemIndex) {
				const stageId = positiveInt(this, 'stageId', itemIndex, 'Stage ID');
				const fields = scrumStageFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject);
				await bitrix24Request.call(this, 'tasks.api.scrum.kanban.updateStage', { stageId, fields }, { itemIndex });
				return { id: stageId, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a sprint kanban stage',
			description: 'Delete a column from a sprint kanban',
			properties: [scrumStageId],
			async execute(itemIndex) {
				const stageId = positiveInt(this, 'stageId', itemIndex, 'Stage ID');
				await bitrix24Request.call(this, 'tasks.api.scrum.kanban.deleteStage', { stageId }, { itemIndex });
				return { id: stageId, deleted: true };
			},
		},
		{
			value: 'addTask',
			name: 'Add Task',
			action: 'Put a task on a sprint kanban',
			description: 'Place a task in a column of the kanban of an active sprint',
			properties: [sprintIdRequired, numberProperty('Task ID', 'taskId', 'ID of the task'), scrumStageId],
			async execute(itemIndex) {
				const params = { ...sprintTask(this, itemIndex), stageId: positiveInt(this, 'stageId', itemIndex, 'Stage ID') };
				await bitrix24Request.call(this, 'tasks.api.scrum.kanban.addTask', params, { itemIndex });
				return { ...params, added: true };
			},
		},
		{
			value: 'removeTask',
			name: 'Remove Task',
			action: 'Take a task off a sprint kanban',
			description: 'Remove a task from the kanban of a sprint',
			properties: [sprintIdRequired, numberProperty('Task ID', 'taskId', 'ID of the task')],
			async execute(itemIndex) {
				const params = sprintTask(this, itemIndex);
				await bitrix24Request.call(this, 'tasks.api.scrum.kanban.deleteTask', params, { itemIndex });
				return { ...params, removed: true };
			},
		},
		getFieldsOperation('sprint kanban stage', 'tasks.api.scrum.kanban.getFields'),
	],
};

// ── Scrum task ────────────────────────────────────────────────────────────

const scrumTaskId = numberProperty('Task ID', 'taskId', 'ID of a task in a scrum');

export const scrumTaskResource: Resource = {
	value: 'scrumTask',
	name: 'Scrum Task',
	description: 'The scrum side of a task: backlog or sprint, epic, story points',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get the scrum data of a task',
			description: 'Read where a task sits in its scrum: backlog or sprint, epic, story points, order',
			properties: [scrumTaskId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.api.scrum.task.get', { id: positiveInt(this, 'taskId', itemIndex, 'Task ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update the scrum data of a task',
			description: 'Move a scrum task between backlog and sprints, set its epic or story points. The task must already be in the scrum group.',
			properties: [
				scrumTaskId,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Backlog or Sprint ID', name: 'entityId', type: 'number', default: 0, description: 'Where the task goes. Leave out to keep it; a new scrum task lands in the backlog.' },
						{ displayName: 'Epic ID', name: 'epicId', type: 'number', default: 0, description: '0 removes the epic' },
						{ displayName: 'Sort', name: 'sort', type: 'number', default: 0 },
						{ displayName: 'Story Points', name: 'storyPoints', type: 'string', default: '', placeholder: '5' },
					],
				},
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				if (optionalInt(o.entityId) !== undefined) fields.entityId = Number(o.entityId);
				if (o.epicId !== undefined) fields.epicId = Number(o.epicId) || 0;
				if (o.sort !== undefined) fields.sort = Number(o.sort) || 0;
				if (o.storyPoints !== undefined) fields.storyPoints = String(o.storyPoints);
				await bitrix24Request.call(this, 'tasks.api.scrum.task.update', { id, fields }, { itemIndex });
				return { id, updated: true, ...fields };
			},
		},
		getFieldsOperation('scrum task', 'tasks.api.scrum.task.getFields'),
	],
};
