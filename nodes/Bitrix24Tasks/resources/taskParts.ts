import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { PAGE_SIZE } from '../../../shared/list';
import { returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, optionalInt, taskIdProperty, v3Result, yn } from '../shared/helpers';

// ── Checklists: of a task, and of a task template ─────────────────────────

const itemId = numberProperty('Item ID', 'itemId', 'ID of the checklist item');
const templateId = numberProperty('Template ID', 'templateId', 'ID of the task template');

function checklistOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Accomplice User IDs', name: 'accomplices', type: 'string', default: '', placeholder: '12, 34', description: 'Comma-separated users responsible for this item; Bitrix24 also adds them to the task as accomplices' },
		{ displayName: 'Auditor User IDs', name: 'auditors', type: 'string', default: '', placeholder: '12, 34', description: 'Comma-separated users watching this item; Bitrix24 also adds them to the task as auditors' },
		{ displayName: 'Important', name: 'important', type: 'boolean', default: true, description: 'Whether the item is marked important' },
		{ displayName: 'Sort Index', name: 'sortIndex', type: 'number', default: 0, description: 'Lower numbers come first within the list' },
	];
	if (forUpdate) {
		options.push(
			{ displayName: 'Parent Item ID', name: 'parentId', type: 'number', default: 0, description: 'Move the item under another item or checklist' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		);
	} else {
		options.push({ displayName: 'Completed', name: 'completed', type: 'boolean', default: false, description: 'Whether the item starts ticked' });
	}
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function checklistFields(ctx: IExecuteFunctions, o: IDataObject, itemIndex: number): IDataObject {
	const fields: IDataObject = {};
	if (o.title !== undefined) fields.TITLE = o.title as string;
	if (o.parentId !== undefined) fields.PARENT_ID = Number(o.parentId) || 0;
	if (o.sortIndex !== undefined) fields.SORT_INDEX = Number(o.sortIndex) || 0;
	if (o.completed !== undefined) fields.IS_COMPLETE = yn(o.completed);
	if (o.important !== undefined) fields.IS_IMPORTANT = yn(o.important);
	const members: IDataObject = {};
	for (const id of idList(ctx, o.accomplices, 'Accomplice User IDs', itemIndex)) members[id] = { TYPE: 'A' };
	for (const id of idList(ctx, o.auditors, 'Auditor User IDs', itemIndex)) members[id] = { TYPE: 'U' };
	if (Object.keys(members).length > 0) fields.MEMBERS = members;
	return fields;
}

const titleProperty: INodeProperties = {
	displayName: 'Title',
	name: 'title',
	type: 'string',
	required: true,
	default: '',
	description: 'Text of the item. With Parent Item ID 0 it is the name of a new checklist.',
};

// The old task.checklistitem.* methods read their arguments by position, so the
// keys below must stay in the documented order: TASKID, ITEMID, then the rest.
function taskItemParams(ctx: IExecuteFunctions, itemIndex: number): { TASKID: number; ITEMID: number } {
	return { TASKID: positiveInt(ctx, 'taskId', itemIndex, 'Task ID'), ITEMID: positiveInt(ctx, 'itemId', itemIndex, 'Item ID') };
}

export const checklistItemResource: Resource = {
	value: 'checklistItem',
	name: 'Checklist Item',
	description: 'Checklists inside a task and their items',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a checklist item to a task',
			description: 'Add an item to a checklist of a task, or start a new checklist',
			properties: [
				taskIdProperty,
				titleProperty,
				numberProperty('Parent Item ID', 'parentId', 'Item or checklist to put this item under. 0 creates a new checklist named by Title; empty adds to the first checklist, creating it if needed.', false),
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: checklistOptions(false) },
			],
			async execute(itemIndex) {
				const o = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject), title: this.getNodeParameter('title', itemIndex) as string };
				const fields = checklistFields(this, o, itemIndex);
				const parent = this.getNodeParameter('parentId', itemIndex, 0) as unknown;
				if (parent !== '' && parent !== null && parent !== undefined) fields.PARENT_ID = Number(parent) || 0;
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const body = await bitrix24Request.call(this, 'task.checklistitem.add', { TASKID: taskId, FIELDS: fields }, { itemIndex });
				return { id: body.result as number, taskId };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a checklist item',
			description: 'Retrieve one checklist item with its members and attachments',
			properties: [taskIdProperty, itemId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.checklistitem.get', taskItemParams(this, itemIndex), { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the checklist items of a task',
			description: 'List every checklist and item of a task; items with PARENT_ID 0 are the checklists themselves',
			properties: [taskIdProperty],
			async execute(itemIndex) {
				const params = { TASKID: positiveInt(this, 'taskId', itemIndex, 'Task ID'), ORDER: { PARENT_ID: 'asc', SORT_INDEX: 'asc' } };
				const body = await bitrix24Request.call(this, 'task.checklistitem.getlist', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a checklist item',
			description: 'Rename, reorder, move or reassign a checklist item',
			properties: [taskIdProperty, itemId, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: checklistOptions(true) }],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				await bitrix24Request.call(this, 'task.checklistitem.update', { ...taskItemParams(this, itemIndex), FIELDS: checklistFields(this, o, itemIndex) }, { itemIndex });
				return { id: positiveInt(this, 'itemId', itemIndex, 'Item ID'), updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a checklist item',
			description: 'Delete a checklist item; deleting a checklist takes its items with it',
			properties: [taskIdProperty, itemId],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'task.checklistitem.delete', taskItemParams(this, itemIndex), { itemIndex });
				return { id: positiveInt(this, 'itemId', itemIndex, 'Item ID'), deleted: true };
			},
		},
		{
			value: 'complete',
			name: 'Complete',
			action: 'Tick a checklist item',
			description: 'Mark a checklist item done',
			properties: [taskIdProperty, itemId],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'task.checklistitem.complete', taskItemParams(this, itemIndex), { itemIndex });
				return { id: positiveInt(this, 'itemId', itemIndex, 'Item ID'), completed: true };
			},
		},
		{
			value: 'reopen',
			name: 'Reopen',
			action: 'Untick a checklist item',
			description: 'Mark a done checklist item as not done again',
			properties: [taskIdProperty, itemId],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'task.checklistitem.renew', taskItemParams(this, itemIndex), { itemIndex });
				return { id: positiveInt(this, 'itemId', itemIndex, 'Item ID'), completed: false };
			},
		},
		{
			value: 'moveAfter',
			name: 'Move After',
			action: 'Move a checklist item after another',
			description: 'Place a checklist item right after another item',
			properties: [taskIdProperty, itemId, numberProperty('After Item ID', 'afterItemId', 'Item to place it after')],
			async execute(itemIndex) {
				const params = { ...taskItemParams(this, itemIndex), AFTERITEMID: positiveInt(this, 'afterItemId', itemIndex, 'After Item ID') };
				await bitrix24Request.call(this, 'task.checklistitem.moveafteritem', params, { itemIndex });
				return { id: params.ITEMID, movedAfter: params.AFTERITEMID };
			},
		},
	],
};

function templateItemParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return { templateId: positiveInt(ctx, 'templateId', itemIndex, 'Template ID'), checkListItemId: positiveInt(ctx, 'itemId', itemIndex, 'Item ID') };
}

function checkListItem(body: IDataObject): IDataObject | IDataObject[] {
	return rows(body.result, 'checkListItem');
}

export const templateChecklistItemResource: Resource = {
	value: 'templateChecklistItem',
	name: 'Template Checklist Item',
	description: 'Checklists stored in a task template and copied into every task made from it',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a checklist item to a template',
			description: 'Add an item to a checklist of a task template, or start a new checklist',
			properties: [
				templateId,
				titleProperty,
				{ displayName: 'Parent Item ID', name: 'parentId', type: 'number', required: true, default: 0, description: 'Item or checklist to put this item under. 0 creates a new checklist named by Title.' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: checklistOptions(false) },
			],
			async execute(itemIndex) {
				const o = {
					...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject),
					title: this.getNodeParameter('title', itemIndex) as string,
					parentId: this.getNodeParameter('parentId', itemIndex) as number,
				};
				const params = { templateId: positiveInt(this, 'templateId', itemIndex, 'Template ID'), fields: checklistFields(this, o, itemIndex) };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.add', params, { itemIndex }));
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a template checklist item',
			description: 'Retrieve one checklist item of a task template',
			properties: [templateId, itemId],
			async execute(itemIndex) {
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.get', templateItemParams(this, itemIndex), { itemIndex }));
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the checklist items of a template',
			description: 'List every checklist and item of a task template',
			properties: [templateId],
			async execute(itemIndex) {
				const params = { templateId: positiveInt(this, 'templateId', itemIndex, 'Template ID'), select: ['ID', 'TEMPLATE_ID', 'PARENT_ID', 'TITLE', 'SORT_INDEX', 'IS_COMPLETE', 'IS_IMPORTANT', 'MEMBERS', 'ATTACHMENTS'] };
				const body = await bitrix24Request.call(this, 'tasks.template.checklist.list', params, { itemIndex });
				const items = ((body.result ?? {}) as IDataObject).checkListItems;
				if (items === null || typeof items !== 'object') return [];
				return Object.values(items as IDataObject) as IDataObject[];
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a template checklist item',
			description: 'Rename, reorder, move or reassign a checklist item of a template',
			properties: [templateId, itemId, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: checklistOptions(true) }],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const params = { ...templateItemParams(this, itemIndex), fields: checklistFields(this, o, itemIndex) };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.update', params, { itemIndex }));
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a template checklist item',
			description: 'Delete a checklist item from a task template',
			properties: [templateId, itemId],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'tasks.template.checklist.delete', templateItemParams(this, itemIndex), { itemIndex });
				return { id: positiveInt(this, 'itemId', itemIndex, 'Item ID'), deleted: true };
			},
		},
		{
			value: 'complete',
			name: 'Complete',
			action: 'Tick a template checklist item',
			description: 'Mark a template checklist item done, so tasks made from the template start with it ticked',
			properties: [templateId, itemId],
			async execute(itemIndex) {
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.complete', templateItemParams(this, itemIndex), { itemIndex }));
			},
		},
		{
			value: 'reopen',
			name: 'Reopen',
			action: 'Untick a template checklist item',
			description: 'Mark a template checklist item as not done',
			properties: [templateId, itemId],
			async execute(itemIndex) {
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.renew', templateItemParams(this, itemIndex), { itemIndex }));
			},
		},
		{
			value: 'moveAfter',
			name: 'Move After',
			action: 'Move a template checklist item after another',
			description: 'Place a template checklist item right after another item',
			properties: [templateId, itemId, numberProperty('After Item ID', 'afterItemId', 'Item to place it after')],
			async execute(itemIndex) {
				const params = { ...templateItemParams(this, itemIndex), afterItemId: positiveInt(this, 'afterItemId', itemIndex, 'After Item ID') };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.moveAfter', params, { itemIndex }));
			},
		},
		{
			value: 'moveBefore',
			name: 'Move Before',
			action: 'Move a template checklist item before another',
			description: 'Place a template checklist item right before another item',
			properties: [templateId, itemId, numberProperty('Before Item ID', 'beforeItemId', 'Item to place it before')],
			async execute(itemIndex) {
				const params = { ...templateItemParams(this, itemIndex), beforeItemId: positiveInt(this, 'beforeItemId', itemIndex, 'Before Item ID') };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.moveBefore', params, { itemIndex }));
			},
		},
		{
			value: 'attachDriveFiles',
			name: 'Attach Drive Files',
			action: 'Attach Drive files to a template checklist item',
			description: 'Attach files that are already on Bitrix24 Drive to a template checklist item',
			properties: [templateId, itemId, { displayName: 'Drive File IDs', name: 'fileIds', type: 'string', required: true, default: '', placeholder: '428, 345', description: 'Comma-separated IDs of Drive files' }],
			async execute(itemIndex) {
				const params = { ...templateItemParams(this, itemIndex), filesIds: idList(this, this.getNodeParameter('fileIds', itemIndex), 'Drive File IDs', itemIndex) };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.addAttachmentsFromDisk', params, { itemIndex }));
			},
		},
		{
			value: 'removeAttachments',
			name: 'Remove Attachments',
			action: 'Remove attachments from a template checklist item',
			description: 'Detach files from a template checklist item by attachment ID',
			properties: [templateId, itemId, { displayName: 'Attachment IDs', name: 'attachmentIds', type: 'string', required: true, default: '', placeholder: '1113, 1115', description: 'Comma-separated attachment IDs, as Get returns them under attachments' }],
			async execute(itemIndex) {
				const params = { ...templateItemParams(this, itemIndex), attachmentsIds: idList(this, this.getNodeParameter('attachmentIds', itemIndex), 'Attachment IDs', itemIndex) };
				return checkListItem(await bitrix24Request.call(this, 'tasks.template.checklist.removeAttachments', params, { itemIndex }));
			},
		},
	],
};

// ── Time spent ────────────────────────────────────────────────────────────

const entryId = numberProperty('Entry ID', 'entryId', 'ID of the time entry');

function entryParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return { TASKID: positiveInt(ctx, 'taskId', itemIndex, 'Task ID'), ITEMID: positiveInt(ctx, 'entryId', itemIndex, 'Entry ID') };
}

const secondsProperty: INodeProperties = { displayName: 'Seconds', name: 'seconds', type: 'number', required: true, typeOptions: { minValue: 1 }, default: 3600, description: 'Time spent, in seconds' };
const commentProperty: INodeProperties = { displayName: 'Comment', name: 'comment', type: 'string', default: '', description: 'What the time was spent on' };

export const timeEntryResource: Resource = {
	value: 'timeEntry',
	name: 'Time Entry',
	description: 'Time spent on a task, as logged by hand or by the timer',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Log time on a task',
			description: 'Record time spent on a task',
			properties: [taskIdProperty, secondsProperty, commentProperty, numberProperty('User ID', 'userId', 'Whose time it is. 0 means the webhook user.', false)],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const fields: IDataObject = { SECONDS: positiveInt(this, 'seconds', itemIndex, 'Seconds'), COMMENT_TEXT: this.getNodeParameter('comment', itemIndex, '') as string };
				const userId = optionalInt(this.getNodeParameter('userId', itemIndex, 0));
				if (userId !== undefined) fields.USER_ID = userId;
				const body = await bitrix24Request.call(this, 'task.elapseditem.add', { TASKID: taskId, ARFIELDS: fields }, { itemIndex });
				return { id: body.result as number, taskId };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a time entry',
			description: 'Retrieve one time entry of a task',
			properties: [taskIdProperty, entryId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'task.elapseditem.get', entryParams(this, itemIndex), { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many time entries',
			description: 'List time entries of one task, or of all tasks the webhook user can see',
			properties: [
				numberProperty('Task ID', 'taskId', 'Task whose entries to list. 0 lists entries across all tasks.', false),
				...returnAllProperties('entries'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Created After', name: 'createdAfter', type: 'dateTime', default: '' },
						{ displayName: 'Created Before', name: 'createdBefore', type: 'dateTime', default: '' },
						{ displayName: 'User ID', name: 'userId', type: 'number', default: 0 },
					],
				},
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter: IDataObject = {};
				if (optionalInt(f.userId) !== undefined) filter.USER_ID = Number(f.userId);
				if (f.createdAfter) filter['>=CREATED_DATE'] = f.createdAfter;
				if (f.createdBefore) filter['<=CREATED_DATE'] = f.createdBefore;
				const taskId = optionalInt(this.getNodeParameter('taskId', itemIndex, 0));

				// Positional arguments again: [TASKID,] ORDER, FILTER, SELECT, PARAMS. Paging is
				// by page number inside PARAMS, 50 per page at most.
				const out: IDataObject[] = [];
				for (let page = 1; page <= 20_000; page++) {
					const params: IDataObject = taskId === undefined ? {} : { TASKID: taskId };
					params.ORDER = { ID: 'asc' };
					params.FILTER = filter;
					params.SELECT = ['*'];
					params.PARAMS = { NAV_PARAMS: { nPageSize: PAGE_SIZE, iNumPage: page } };
					const body = await bitrix24Request.call(this, 'task.elapseditem.getlist', params, { itemIndex });
					const pageRows = Array.isArray(body.result) ? (body.result as IDataObject[]) : [];
					out.push(...pageRows);
					if (limit !== undefined && out.length >= limit) return out.slice(0, limit);
					if (pageRows.length < PAGE_SIZE) break;
				}
				return out;
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a time entry',
			description: 'Change the seconds and comment of a time entry',
			properties: [taskIdProperty, entryId, secondsProperty, commentProperty],
			async execute(itemIndex) {
				const fields = { SECONDS: positiveInt(this, 'seconds', itemIndex, 'Seconds'), COMMENT_TEXT: this.getNodeParameter('comment', itemIndex, '') as string };
				await bitrix24Request.call(this, 'task.elapseditem.update', { ...entryParams(this, itemIndex), ARFIELDS: fields }, { itemIndex });
				return { id: positiveInt(this, 'entryId', itemIndex, 'Entry ID'), updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a time entry',
			description: 'Delete a time entry from a task',
			properties: [taskIdProperty, entryId],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'task.elapseditem.delete', entryParams(this, itemIndex), { itemIndex });
				return { id: positiveInt(this, 'entryId', itemIndex, 'Entry ID'), deleted: true };
			},
		},
	],
};

// ── Results ───────────────────────────────────────────────────────────────

const resultId = numberProperty('Result ID', 'resultId', 'ID of the result');
const resultText: INodeProperties = { displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '' };

export const resultResource: Resource = {
	value: 'result',
	name: 'Result',
	description: 'What came out of a task, recorded so a task that requires a result can be completed',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a result to a task',
			description: 'Record the result of a task',
			properties: [taskIdProperty, resultText],
			async execute(itemIndex) {
				const fields = { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID'), text: this.getNodeParameter('text', itemIndex) as string };
				return v3Result(await bitrix24Request.call(this, 'tasks.task.result.add', { fields }, { v3: true, itemIndex }), 'item');
			},
		},
		{
			value: 'createFromMessage',
			name: 'Create From Chat Message',
			action: 'Make a task chat message the result',
			description: 'Turn a message of the task chat into the result of the task',
			properties: [numberProperty('Message ID', 'messageId', 'ID of a message in the task chat, e.g. from the Task Comment Added trigger event')],
			async execute(itemIndex) {
				const fields = { messageId: positiveInt(this, 'messageId', itemIndex, 'Message ID') };
				return v3Result(await bitrix24Request.call(this, 'tasks.task.result.addfromchatmessage', { fields }, { v3: true, itemIndex }), 'item');
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the results of a task',
			description: 'List the results recorded for a task; status 0 is open, 1 is closed by completing the task',
			properties: [taskIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'tasks.task.result.list', { taskId: positiveInt(this, 'taskId', itemIndex, 'Task ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a task result',
			description: 'Replace the text of a result',
			properties: [resultId, resultText],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'resultId', itemIndex, 'Result ID'), fields: { text: this.getNodeParameter('text', itemIndex) as string } };
				return v3Result(await bitrix24Request.call(this, 'tasks.task.result.update', params, { v3: true, itemIndex }), 'item');
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a task result',
			description: 'Delete a result from a task',
			properties: [resultId],
			async execute(itemIndex) {
				const id = positiveInt(this, 'resultId', itemIndex, 'Result ID');
				await bitrix24Request.call(this, 'tasks.task.result.delete', { id }, { v3: true, itemIndex });
				return { id, deleted: true };
			},
		},
	],
};

// ── Dependencies (Gantt links) ────────────────────────────────────────────

const LINK_TYPES = [
	{ name: 'Finish → Finish', value: 3 },
	{ name: 'Finish → Start', value: 2 },
	{ name: 'Start → Finish', value: 1 },
	{ name: 'Start → Start', value: 0 },
];

const dependencyTasks: INodeProperties[] = [
	numberProperty('From Task ID', 'taskIdFrom', 'Task the link starts at'),
	numberProperty('To Task ID', 'taskIdTo', 'Task that depends on it'),
];

export const dependencyResource: Resource = {
	value: 'dependency',
	name: 'Dependency',
	description: 'Gantt links between tasks: one starts or finishes when another does',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Link two tasks',
			description: 'Make one task depend on another on the Gantt chart',
			properties: [...dependencyTasks, { displayName: 'Link Type', name: 'linkType', type: 'options', default: 2, options: LINK_TYPES, description: 'Which end of the first task the second waits for, and which end of the second it moves' }],
			async execute(itemIndex) {
				const params = {
					taskIdFrom: positiveInt(this, 'taskIdFrom', itemIndex, 'From Task ID'),
					taskIdTo: positiveInt(this, 'taskIdTo', itemIndex, 'To Task ID'),
					linkType: Number(this.getNodeParameter('linkType', itemIndex)),
				};
				await bitrix24Request.call(this, 'task.dependence.add', params, { itemIndex });
				return { linked: true, ...params };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Unlink two tasks',
			description: 'Remove the dependency between two tasks',
			properties: dependencyTasks,
			async execute(itemIndex) {
				const params = { taskIdFrom: positiveInt(this, 'taskIdFrom', itemIndex, 'From Task ID'), taskIdTo: positiveInt(this, 'taskIdTo', itemIndex, 'To Task ID') };
				await bitrix24Request.call(this, 'task.dependence.delete', params, { itemIndex });
				return { unlinked: true, ...params };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the dependencies of a task',
			description: 'List the tasks a task depends on through Gantt links, with the link type: after Create from A to B, Get Many of B returns A',
			properties: [taskIdProperty],
			async execute(itemIndex) {
				const taskId = positiveInt(this, 'taskId', itemIndex, 'Task ID');
				const limit = 1000;
				const out: IDataObject[] = [];
				for (let page = 1; page <= 1000; page++) {
					const body = await bitrix24Request.call(this, 'tasks.task.gantt.link.list', { filter: [['taskId', taskId]], pagination: { page, limit } }, { v3: true, itemIndex });
					const items = v3Result(body, 'items');
					const pageRows = Array.isArray(items) ? items : [];
					out.push(...pageRows);
					if (pageRows.length < limit) break;
				}
				return out;
			},
		},
	],
};
