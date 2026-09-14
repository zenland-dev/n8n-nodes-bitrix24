import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { crudOperations } from '../../../shared/crud';
import { jsonValue } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityPairs, optionalInt, taskIdProperty, yn } from '../shared/helpers';

// ── Kanban and My Plan stages ─────────────────────────────────────────────

const kanbanOwner: INodeProperties = {
	displayName: 'Kanban Name or ID',
	name: 'kanbanId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getKanbans' },
	required: true,
	default: 0,
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'A group or project kanban, or 0 for My Plan of the webhook user',
};

const stageId = numberProperty('Stage ID', 'stageId', 'ID of the kanban or My Plan stage');

function stageFields(o: IDataObject): IDataObject {
	const fields: IDataObject = {};
	if (o.title !== undefined) fields.TITLE = o.title as string;
	if (o.color !== undefined) fields.COLOR = String(o.color).replace(/^#/, '').toUpperCase();
	if (o.afterId !== undefined) fields.AFTER_ID = Number(o.afterId) || 0;
	return fields;
}

const stageColor: INodeProperties = { displayName: 'Color', name: 'color', type: 'color', default: '#00C4FB' };
const stageAfter: INodeProperties = { displayName: 'After Stage ID', name: 'afterId', type: 'number', default: 0, description: 'Stage to place this one after. 0 puts it first.' };

export const stageResource: Resource = {
	value: 'stage',
	name: 'Kanban Stage',
	description: 'Columns of a group kanban or of My Plan, and moving tasks between them',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a kanban stage',
			description: 'Add a column to a group kanban or to My Plan of the webhook user',
			properties: [
				kanbanOwner,
				{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: [stageAfter, stageColor] },
			],
			async execute(itemIndex) {
				const o = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject), title: this.getNodeParameter('title', itemIndex) as string };
				const fields = { ...stageFields(o), ENTITY_ID: Number(this.getNodeParameter('kanbanId', itemIndex)) || 0 };
				const body = await bitrix24Request.call(this, 'task.stages.add', { fields }, { itemIndex });
				return { id: body.result as number, ...fields };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the stages of a kanban',
			description: 'List the columns of a group kanban or of My Plan, in order',
			properties: [kanbanOwner],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.stages.get', { entityId: Number(this.getNodeParameter('kanbanId', itemIndex)) || 0 }, { itemIndex });
				const result = body.result;
				if (result === null || typeof result !== 'object') return [];
				return (Array.isArray(result) ? result : Object.values(result as IDataObject)) as IDataObject[];
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a kanban stage',
			description: 'Rename, recolour or move a kanban stage',
			properties: [
				stageId,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [stageAfter, stageColor, { displayName: 'Title', name: 'title', type: 'string', default: '' }],
				},
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'stageId', itemIndex, 'Stage ID');
				const fields = stageFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject);
				await bitrix24Request.call(this, 'task.stages.update', { id, fields }, { itemIndex });
				return { id, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a kanban stage',
			description: 'Delete a kanban stage. Bitrix24 refuses while the stage still holds tasks.',
			properties: [stageId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'stageId', itemIndex, 'Stage ID');
				await bitrix24Request.call(this, 'task.stages.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'moveTask',
			name: 'Move Task',
			action: 'Move a task to a kanban stage',
			description: 'Put a task into a stage of its group kanban or of My Plan, optionally next to another task',
			properties: [
				taskIdProperty,
				stageId,
				{
					displayName: 'Position',
					name: 'position',
					type: 'collection',
					placeholder: 'Add Position',
					default: {},
					options: [
						{ displayName: 'After Task ID', name: 'after', type: 'number', default: 0 },
						{ displayName: 'Before Task ID', name: 'before', type: 'number', default: 0 },
					],
				},
			],
			async execute(itemIndex) {
				const params: IDataObject = { id: positiveInt(this, 'taskId', itemIndex, 'Task ID'), stageId: positiveInt(this, 'stageId', itemIndex, 'Stage ID') };
				const p = (this.getNodeParameter('position', itemIndex, {}) ?? {}) as IDataObject;
				if (optionalInt(p.before) !== undefined && optionalInt(p.after) !== undefined) {
					throw new NodeOperationError(this.getNode(), 'Set either Before Task ID or After Task ID, not both', { itemIndex });
				}
				if (optionalInt(p.before) !== undefined) params.before = Number(p.before);
				if (optionalInt(p.after) !== undefined) params.after = Number(p.after);
				await bitrix24Request.call(this, 'task.stages.movetask', params, { itemIndex });
				return { taskId: params.id, stageId: params.stageId, moved: true };
			},
		},
		{
			value: 'canMoveTasks',
			name: 'Check Move Permission',
			action: 'Check whether tasks can be moved in a kanban',
			description: 'Answer whether the webhook user may move tasks between stages of a group kanban or of a user plan',
			properties: [
				{
					displayName: 'Kanban Of',
					name: 'ownerType',
					type: 'options',
					default: 'G',
					options: [
						{ name: 'Group', value: 'G' },
						{ name: 'User (My Plan)', value: 'U' },
					],
				},
				numberProperty('Group or User ID', 'ownerId', 'ID of the group, or of the user whose plan it is; only the webhook user may move tasks in their own plan'),
			],
			async execute(itemIndex) {
				const params = { entityId: positiveInt(this, 'ownerId', itemIndex, 'Group or User ID'), entityType: this.getNodeParameter('ownerType', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'task.stages.canmovetask', params, { itemIndex });
				return { ...params, allowed: body.result === true };
			},
		},
	],
};

// ── Custom fields ─────────────────────────────────────────────────────────

const fieldId = numberProperty('Field ID', 'fieldId', 'ID of the custom field, not its name');

function customFieldOptions(): INodeProperties[] {
	return [
		{ displayName: 'External ID', name: 'xmlId', type: 'string', default: '' },
		{ displayName: 'Labels (JSON)', name: 'labelsJson', type: 'json', default: '{}', description: 'Label per interface language, e.g. {"en": "Budget", "de": "Budget"}' },
		{ displayName: 'Mandatory', name: 'mandatory', type: 'boolean', default: false, description: 'Whether every task must fill the field' },
		{ displayName: 'Multiple', name: 'multiple', type: 'boolean', default: false, description: 'Whether the field holds several values; ignored for yes/no fields' },
		{ displayName: 'Settings (JSON)', name: 'settingsJson', type: 'json', default: '{}', description: 'Type-specific settings, e.g. {"DEFAULT_VALUE": "x", "ROWS": 3} for a string' },
		{ displayName: 'Sort', name: 'sort', type: 'number', default: 100 },
	];
}

function customFieldParams(ctx: IExecuteFunctions, o: IDataObject, itemIndex: number): IDataObject {
	const params: IDataObject = {};
	if (o.label !== undefined) params.LABEL = o.label as string;
	if (o.xmlId !== undefined) params.XML_ID = o.xmlId as string;
	if (o.sort !== undefined) params.SORT = Number(o.sort) || 0;
	if (o.mandatory !== undefined) params.MANDATORY = yn(o.mandatory);
	if (o.multiple !== undefined) params.MULTIPLE = yn(o.multiple);
	const labels = jsonValue<IDataObject>(ctx, o.labelsJson, 'Labels (JSON)', itemIndex, {});
	if (Object.keys(labels).length > 0) params.EDIT_FORM_LABEL = labels;
	const settings = jsonValue<IDataObject>(ctx, o.settingsJson, 'Settings (JSON)', itemIndex, {});
	if (Object.keys(settings).length > 0) params.SETTINGS = settings;
	return params;
}

export const customFieldResource: Resource = {
	value: 'customField',
	name: 'Custom Field',
	description: 'Custom fields of tasks: the UF_ fields an administrator adds to the task form',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a task custom field',
			description: 'Add a custom field to every task of the portal',
			properties: [
				{ displayName: 'Field Name', name: 'fieldName', type: 'string', required: true, default: '', placeholder: 'UF_BUDGET', description: 'Code of the field. Bitrix24 adds the UF_ prefix when it is missing.' },
				{
					displayName: 'Type',
					name: 'userTypeId',
					type: 'options',
					default: 'string',
					options: [
						{ name: 'Date and Time', value: 'datetime' },
						{ name: 'Number', value: 'double' },
						{ name: 'String', value: 'string' },
						{ name: 'Yes/No', value: 'boolean' },
					],
				},
				{ displayName: 'Label', name: 'label', type: 'string', default: '', description: 'Name people see on the task form' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: customFieldOptions() },
			],
			async execute(itemIndex) {
				const o = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject), label: this.getNodeParameter('label', itemIndex, '') as string };
				const params = {
					USER_TYPE_ID: this.getNodeParameter('userTypeId', itemIndex) as string,
					FIELD_NAME: this.getNodeParameter('fieldName', itemIndex) as string,
					...customFieldParams(this, o, itemIndex),
				};
				const body = await bitrix24Request.call(this, 'task.item.userfield.add', { PARAMS: params }, { itemIndex });
				return { id: body.result as number, fieldName: params.FIELD_NAME };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a task custom field',
			description: 'Retrieve the settings of one custom field',
			properties: [fieldId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.item.userfield.get', { ID: positiveInt(this, 'fieldId', itemIndex, 'Field ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the task custom fields',
			description: 'List every custom field of tasks, the three built-in links to CRM, mail and Drive included',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.item.userfield.getlist', { ORDER: { SORT: 'asc' }, FILTER: {} }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a task custom field',
			description: 'Change the label, flags or settings of a custom field; its name and type cannot change',
			properties: [
				fieldId,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [...customFieldOptions(), { displayName: 'Label', name: 'label', type: 'string', default: '' } as INodeProperties].sort((a, b) => a.displayName.localeCompare(b.displayName)),
				},
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'fieldId', itemIndex, 'Field ID');
				const data = customFieldParams(this, (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject, itemIndex);
				await bitrix24Request.call(this, 'task.item.userfield.update', { ID: id, DATA: data }, { itemIndex });
				return { id, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a task custom field',
			description: 'Delete a custom field and its values in every task',
			properties: [fieldId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'fieldId', itemIndex, 'Field ID');
				await bitrix24Request.call(this, 'task.item.userfield.delete', { ID: id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'getTypes',
			name: 'Get Types',
			action: 'Get the custom field types',
			description: 'List the data types a task custom field can have',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.item.userfield.gettypes', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the settings a custom field has',
			description: 'Describe the settings of a custom field itself: which can be written and which never change',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.item.userfield.getfields', {}, { itemIndex });
				return Object.entries((body.result ?? {}) as IDataObject).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
	],
};

// ── Templates ─────────────────────────────────────────────────────────────

export const templateResource: Resource = {
	value: 'template',
	name: 'Task Template',
	description: 'Saved task settings that new tasks, recurring tasks and flows are made from',
	operations: crudOperations({
		prefix: 'tasks.template',
		noun: 'task template',
		plural: 'task templates',
		kinds: ['create', 'get', 'update', 'delete', 'getFields'],
		idKey: 'templateId',
		fieldsExample: '{"TITLE": "Weekly report", "CREATED_BY": 1, "RESPONSIBLE_ID": 1, "DEADLINE_AFTER": 86400}',
		descriptions: {
			create: 'Create a task template; TITLE, CREATED_BY and RESPONSIBLE_ID are required. Bitrix24 has no method to list templates.',
			getFields: 'Describe the fields a task template has, with types and allowed values',
		},
	}),
};

// ── Flows ─────────────────────────────────────────────────────────────────

const flowId = numberProperty('Flow ID', 'flowId', 'ID of the flow, as Create returns it or a task in the flow shows in flowId');

const DISTRIBUTION = [
	{ name: 'Manual (Moderator Assigns)', value: 'manually' },
	{ name: 'Queue (Team Members in Turn)', value: 'queue' },
	{ name: 'Self-Assignment (Team Members Take Tasks)', value: 'himself' },
];

function flowOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Administrator User ID', name: 'ownerId', type: 'number', default: 0, description: 'Flow administrator. Defaults to the webhook user.' },
		{ displayName: 'Anyone Can Add Tasks', name: 'everyoneCreates', type: 'boolean', default: true, description: 'Whether every employee may put tasks into the flow. Off limits it to Task Creator User IDs.' },
		{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
		{
			displayName: 'Group Name or ID',
			name: 'groupId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getWorkgroups' },
			default: '',
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			hint: 'Group the flow tasks live in. Without one, Bitrix24 creates a group for the flow.',
		},
		{ displayName: 'Match Work Time', name: 'matchWorkTime', type: 'boolean', default: true, description: 'Whether deadlines skip weekends and holidays' },
		{ displayName: 'Notify at Half Time', name: 'notifyAtHalfTime', type: 'boolean', default: false, description: 'Whether the responsible user is reminded halfway to the deadline' },
		{ displayName: 'Notify When Efficiency Below (%)', name: 'notifyWhenEfficiencyDecreases', type: 'number', default: 0, description: 'Notify the administrator when efficiency drops below this. 0 turns it off.' },
		{ displayName: 'Notify When In Progress Over', name: 'notifyOnTasksInProgressOverflow', type: 'number', default: 0, description: 'Notify the administrator when more tasks than this are in progress. 0 turns it off.' },
		{ displayName: 'Notify When Queue Over', name: 'notifyOnQueueOverflow', type: 'number', default: 0, description: 'Notify the administrator when more tasks than this wait in the queue. 0 turns it off.' },
		{ displayName: 'Responsible Can Change Deadline', name: 'responsibleCanChangeDeadline', type: 'boolean', default: false, description: 'Whether the responsible user may move a flow task deadline' },
		{ displayName: 'Task Control', name: 'taskControl', type: 'boolean', default: false, description: 'Whether completed tasks go back to their creator for approval' },
		{ displayName: 'Task Creator Department IDs', name: 'creatorDepartments', type: 'string', default: '', placeholder: '3, 17', description: 'With Anyone Can Add Tasks off: departments whose employees may add tasks, sub-departments included' },
		{ displayName: 'Task Creator User IDs', name: 'creatorUsers', type: 'string', default: '', placeholder: '12, 34', description: 'With Anyone Can Add Tasks off: users who may add tasks' },
		{ displayName: 'Template ID', name: 'templateId', type: 'number', default: 0, description: 'Task template new flow tasks are filled from' },
	];
	if (forUpdate) {
		options.push({ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'New name; it must stay unique among flows' });
	}
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const flowRequired: INodeProperties[] = [
	{ displayName: 'Planned Hours per Task', name: 'plannedHours', type: 'number', required: true, typeOptions: { minValue: 0.25, numberPrecision: 2 }, default: 24, description: 'Time the flow gives each task; the deadline is set from it' },
	{ displayName: 'Distribution', name: 'distributionType', type: 'options', default: 'manually', options: DISTRIBUTION, description: 'How tasks find their responsible user' },
	{ displayName: 'Team User IDs', name: 'teamUsers', type: 'string', default: '', placeholder: '12, 34', description: 'Manual: the moderator. Queue and self-assignment: the members, together with Team Department IDs.' },
	{ displayName: 'Team Department IDs', name: 'teamDepartments', type: 'string', default: '', placeholder: '3, 17', description: 'Queue and self-assignment: departments whose employees are members' },
	{ displayName: 'Include Sub-Departments', name: 'withSubDepartments', type: 'boolean', default: true, description: 'Whether team departments take in their sub-departments' },
];

function flowData(ctx: IExecuteFunctions, itemIndex: number, o: IDataObject): IDataObject {
	const data: IDataObject = {
		plannedCompletionTime: Math.round(Number(ctx.getNodeParameter('plannedHours', itemIndex)) * 3600),
		distributionType: ctx.getNodeParameter('distributionType', itemIndex) as string,
		responsibleList: entityPairs(
			ctx,
			ctx.getNodeParameter('teamUsers', itemIndex, ''),
			ctx.getNodeParameter('teamDepartments', itemIndex, ''),
			ctx.getNodeParameter('withSubDepartments', itemIndex, true) as boolean,
			itemIndex,
		),
	};
	if ((data.responsibleList as unknown[]).length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'A flow needs a team: fill Team User IDs or Team Department IDs', { itemIndex });
	}
	if (o.name !== undefined && o.name !== '') data.name = o.name as string;
	if (o.description !== undefined) data.description = o.description as string;
	if (o.groupId !== undefined && o.groupId !== '') data.groupId = Number(o.groupId);
	for (const key of ['ownerId', 'templateId']) if (optionalInt(o[key]) !== undefined) data[key] = Number(o[key]);
	for (const key of ['matchWorkTime', 'responsibleCanChangeDeadline', 'notifyAtHalfTime', 'taskControl']) {
		if (o[key] !== undefined) data[key] = o[key] === true ? 1 : 0;
	}
	for (const key of ['notifyOnQueueOverflow', 'notifyOnTasksInProgressOverflow', 'notifyWhenEfficiencyDecreases']) {
		if (o[key] !== undefined) data[key] = optionalInt(o[key]) ?? null;
	}
	if (o.everyoneCreates === true) data.taskCreators = [['meta-user', 'all-users']];
	if (o.everyoneCreates === false) data.taskCreators = entityPairs(ctx, o.creatorUsers, o.creatorDepartments, true, itemIndex);
	return data;
}

async function setFlowActive(ctx: IExecuteFunctions, itemIndex: number, active: boolean): Promise<IDataObject> {
	const id = positiveInt(ctx, 'flowId', itemIndex, 'Flow ID');
	// activate is a toggle; read the state first so the operation means what it says.
	const current = await bitrix24Request.call(ctx, 'tasks.flow.Flow.get', { flowId: id }, { itemIndex });
	const wasActive = ((current.result ?? {}) as IDataObject).active === true;
	if (wasActive !== active) await bitrix24Request.call(ctx, 'tasks.flow.Flow.activate', { flowId: id }, { itemIndex });
	return { id, active, changed: wasActive !== active };
}

export const flowResource: Resource = {
	value: 'flow',
	name: 'Flow',
	description: 'Flows: a queue that hands incoming tasks to a team by rules',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a flow',
			description: 'Create a flow with its team and distribution rule',
			properties: [
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '', description: 'Unique among flows; Check Name tells whether it is taken' },
				...flowRequired,
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: flowOptions(false) },
			],
			async execute(itemIndex) {
				const o = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject), name: this.getNodeParameter('name', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.create', { flowData: flowData(this, itemIndex, o) }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a flow',
			description: 'Retrieve a flow with its team, rules and efficiency',
			properties: [flowId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.get', { flowId: positiveInt(this, 'flowId', itemIndex, 'Flow ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a flow',
			description: 'Change a flow. Bitrix24 resets settings left out, the template among them, so give every setting the flow should keep.',
			properties: [flowId, ...flowRequired, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: flowOptions(true) }],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const data = { id: positiveInt(this, 'flowId', itemIndex, 'Flow ID'), ...flowData(this, itemIndex, o) };
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.update', { flowData: data }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a flow',
			description: 'Delete a flow; its tasks stay',
			properties: [flowId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'flowId', itemIndex, 'Flow ID');
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.delete', { flowData: { id } }, { itemIndex });
				return { id, deleted: ((body.result ?? {}) as IDataObject).deleted === true };
			},
		},
		{
			value: 'activate',
			name: 'Activate',
			action: 'Turn a flow on',
			description: 'Turn a flow on so it accepts tasks; does nothing when it is already on',
			properties: [flowId],
			async execute(itemIndex) {
				return await setFlowActive(this, itemIndex, true);
			},
		},
		{
			value: 'deactivate',
			name: 'Deactivate',
			action: 'Turn a flow off',
			description: 'Turn a flow off; does nothing when it is already off',
			properties: [flowId],
			async execute(itemIndex) {
				return await setFlowActive(this, itemIndex, false);
			},
		},
		{
			value: 'togglePin',
			name: 'Toggle Pin',
			action: 'Pin or unpin a flow',
			description: 'Pin a flow to the top of the flow list of the webhook user, or unpin it if it is pinned',
			properties: [flowId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'flowId', itemIndex, 'Flow ID');
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.pin', { flowId: id }, { itemIndex });
				// The answer is the new state: true when the flow is now pinned, false when unpinned.
				return { id, pinned: body.result === true };
			},
		},
		{
			value: 'checkName',
			name: 'Check Name',
			action: 'Check whether a flow name is taken',
			description: 'Answer whether a flow with this name already exists',
			properties: [
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				numberProperty('Except Flow ID', 'exceptId', 'Leave this flow out of the check, for renaming it', false),
			],
			async execute(itemIndex) {
				const data: IDataObject = { name: this.getNodeParameter('name', itemIndex) as string };
				const except = optionalInt(this.getNodeParameter('exceptId', itemIndex, 0));
				if (except !== undefined) data.id = except;
				const body = await bitrix24Request.call(this, 'tasks.flow.Flow.isExists', { flowData: data }, { itemIndex });
				return { name: data.name, exists: ((body.result ?? {}) as IDataObject).exists === true };
			},
		},
	],
};
