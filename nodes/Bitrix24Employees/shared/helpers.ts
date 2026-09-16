import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { instantOf } from '../../../shared/datetime';
import { compact, jsonParameter, stringList } from '../../../shared/params';
import { idList } from '../../../shared/values';

/**
 * Employee methods take their filter flat, in the body itself: `user.get` reads `ACTIVE`,
 * `UF_DEPARTMENT` and the rest next to `sort`, `select` and `start`, not inside a `filter`
 * object the way CRM does. Everything here builds that shape.
 */

export const userIdProperty: INodeProperties = {
	displayName: 'Employee ID',
	name: 'userId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the employee, as Get Many returns it in ID',
};

export const optionalUserIdProperty: INodeProperties = {
	displayName: 'Employee ID',
	name: 'userId',
	type: 'number',
	default: 0,
	description: 'Whose working day to act on. 0 means the user the webhook acts as.',
	hint: 'Another employee needs the right to manage other people working time',
};

/** ATOM (ISO-8601 with an offset), which is what timeman reads. */
export function atomTime(ctx: IExecuteFunctions, value: unknown, label: string, itemIndex: number): string | undefined {
	const text = String(value ?? '').trim();
	if (text === '') return undefined;
	const instant = instantOf(text, ctx.getTimezone());
	if (instant === undefined) {
		throw new NodeOperationError(ctx.getNode(), `${label} is not a date`, {
			itemIndex,
			description: 'Give a date and time, or an expression that returns one.',
		});
	}
	return instant.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

/** A positive ID, or undefined when the parameter is left at 0. */
export function optionalId(ctx: IExecuteFunctions, name: string, itemIndex: number): number | undefined {
	const value = Number(ctx.getNodeParameter(name, itemIndex, 0)) || 0;
	return value > 0 ? value : undefined;
}

export function requiredId(ctx: IExecuteFunctions, name: string, itemIndex: number, label: string): number {
	const value = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(value) || value <= 0) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a positive whole number`, { itemIndex });
	}
	return value;
}

// ── Employee fields ────────────────────────────────────────────────────────

/** The fields of an employee worth a parameter of their own; the rest go through Fields (JSON). */
function employeeFieldOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{
			displayName: 'Birthday',
			name: 'PERSONAL_BIRTHDAY',
			type: 'dateTime',
			default: '',
			description: 'Date of birth',
		},
		{
			displayName: 'City',
			name: 'PERSONAL_CITY',
			type: 'string',
			default: '',
			description: 'City the employee lives in',
		},
		{
			displayName: 'Department IDs',
			name: 'UF_DEPARTMENT',
			type: 'string',
			default: '',
			placeholder: '1, 5',
			description:
				'Comma-separated departments the employee belongs to. An intranet employee needs at least one.',
		},
		{
			displayName: 'Extension',
			name: 'UF_PHONE_INNER',
			type: 'string',
			default: '',
			description: 'Internal phone number',
		},
		{
			displayName: 'First Name',
			name: 'NAME',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Job Title',
			name: 'WORK_POSITION',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Last Name',
			name: 'LAST_NAME',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Middle Name',
			name: 'SECOND_NAME',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Mobile Phone',
			name: 'PERSONAL_MOBILE',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Work Phone',
			name: 'WORK_PHONE',
			type: 'string',
			default: '',
		},
	];

	if (forUpdate) {
		options.unshift({
			displayName: 'Active',
			name: 'ACTIVE',
			type: 'boolean',
			default: true,
			description: 'Whether the employee still works here. Turning it off dismisses them.',
		});
		options.splice(
			options.findIndex((o) => o.displayName === 'Extension'),
			0,
			{
				displayName: 'Email',
				name: 'EMAIL',
				type: 'string',
				placeholder: 'name@example.com',
				default: '',
				description: 'Address the employee signs in with',
			},
		);
	}
	return options;
}

export function employeeFieldsProperty(forUpdate: boolean): INodeProperties {
	return {
		displayName: forUpdate ? 'Update Fields' : 'Additional Fields',
		name: forUpdate ? 'updateFields' : 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: employeeFieldOptions(forUpdate),
	};
}

export const employeeJsonProperty: INodeProperties = {
	displayName: 'Fields (JSON)',
	name: 'fieldsJson',
	type: 'json',
	default: '{}',
	description:
		'Fields merged over the ones above, for everything without a field of its own, e.g. {"PERSONAL_WWW": "https://example.com", "UF_SKILLS": "n8n"}. Get Fields lists what the webhook may write.',
};

/** The body of user.add and user.update: named fields, then the JSON, with lists made into arrays. */
export function employeeBody(
	ctx: IExecuteFunctions,
	itemIndex: number,
	source: IDataObject,
): IDataObject {
	const body: IDataObject = { ...compact(source), ...jsonParameter<IDataObject>(ctx, 'fieldsJson', itemIndex, {}) };

	if (body.UF_DEPARTMENT !== undefined) {
		body.UF_DEPARTMENT = idList(ctx, body.UF_DEPARTMENT, 'Department IDs', itemIndex);
	}
	if (typeof body.ACTIVE === 'boolean') body.ACTIVE = body.ACTIVE ? 'Y' : 'N';
	if (body.PERSONAL_BIRTHDAY !== undefined) {
		body.PERSONAL_BIRTHDAY = atomTime(ctx, body.PERSONAL_BIRTHDAY, 'Birthday', itemIndex);
	}
	return compact(body);
}

// ── Reading employees ──────────────────────────────────────────────────────

export const employeeFilterProperty: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	options: [
		{
			displayName: 'Active Only',
			name: 'ACTIVE',
			type: 'boolean',
			default: true,
			description: 'Whether to leave out employees who no longer work here',
		},
		{
			displayName: 'Department Name or ID',
			name: 'UF_DEPARTMENT',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getDepartments' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			hint: 'Only employees of this department',
		},
		{
			displayName: 'Email',
			name: 'EMAIL',
			type: 'string',
			placeholder: 'name@example.com',
			default: '',
		},
		{
			displayName: 'Extension',
			name: 'UF_PHONE_INNER',
			type: 'string',
			default: '',
			description: 'Internal phone number',
		},
		{
			displayName: 'Name Search',
			name: 'NAME_SEARCH',
			type: 'string',
			default: '',
			description: 'Quick search over the name, last name and other personal data',
		},
		{
			displayName: 'Online Only',
			name: 'IS_ONLINE',
			type: 'boolean',
			default: false,
			description: 'Whether to leave out employees who are not signed in right now',
		},
		{
			displayName: 'User Type',
			name: 'USER_TYPE',
			type: 'options',
			default: 'employee',
			options: [
				{ name: 'Email User', value: 'email' },
				{ name: 'Employee', value: 'employee' },
				{ name: 'Extranet User', value: 'extranet' },
			],
		},
	],
};

export const employeeFilterJsonProperty: INodeProperties = {
	displayName: 'Filter (JSON)',
	name: 'filterJson',
	type: 'json',
	default: '{}',
	description:
		'Filter merged over the fields above, written flat as this method takes it. Put a comparison in front of a field: &gt;, &gt;=, &lt;, &lt;=, %, ! or @ for a list, e.g. {"&gt;LAST_LOGIN": "2026-01-01T00:00:00+03:00", "@ID": [1, 5]}.',
};

/** Flat filter for user.get: the named fields, the JSON, and the flags Bitrix24 spells Y/N. */
export function employeeFilter(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const chosen = { ...((ctx.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject) };

	if (chosen.UF_DEPARTMENT !== undefined && Number(chosen.UF_DEPARTMENT) <= 0) delete chosen.UF_DEPARTMENT;
	if (chosen.IS_ONLINE !== undefined) chosen.IS_ONLINE = chosen.IS_ONLINE === true ? 'Y' : 'N';

	return { ...compact(chosen), ...jsonParameter<IDataObject>(ctx, 'filterJson', itemIndex, {}) };
}

export const selectProperty: INodeProperties = {
	displayName: 'Fields to Return',
	name: 'select',
	type: 'string',
	default: '',
	placeholder: 'ID, NAME, LAST_NAME, EMAIL',
	description:
		'Comma-separated field names. Leave empty for every field the webhook may read; * means all of them, UF_* all custom ones. Asking for fewer fields makes the call faster.',
};

export const sortProperties: INodeProperties[] = [
	{
		displayName: 'Sort By',
		name: 'sort',
		type: 'string',
		default: '',
		placeholder: 'LAST_NAME',
		description: 'Field to sort by. Empty sorts by ID, ascending.',
	},
	{
		displayName: 'Sort Direction',
		name: 'order',
		type: 'options',
		default: 'ASC',
		options: [
			{ name: 'Ascending', value: 'ASC' },
			{ name: 'Descending', value: 'DESC' },
		],
	},
];

export const adminModeProperty: INodeProperties = {
	displayName: 'Administrator Mode',
	name: 'adminMode',
	type: 'boolean',
	default: false,
	description:
		'Whether to read data of every employee, which needs the webhook user to be an administrator',
};

/** sort, order, select and ADMIN_MODE, as every reading method of this node takes them. */
export function readingOptions(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const select = stringList(ctx.getNodeParameter('select', itemIndex, ''));
	const sort = String(ctx.getNodeParameter('sort', itemIndex, '')).trim();
	return compact({
		sort: sort === '' ? undefined : sort,
		order: sort === '' ? undefined : ctx.getNodeParameter('order', itemIndex, 'ASC'),
		select: select.length > 0 ? select : undefined,
		ADMIN_MODE: (ctx.getNodeParameter('adminMode', itemIndex, false) as boolean) ? true : undefined,
	});
}

export function limitOf(ctx: IExecuteFunctions, itemIndex: number): number | undefined {
	return (ctx.getNodeParameter('returnAll', itemIndex) as boolean)
		? undefined
		: (ctx.getNodeParameter('limit', itemIndex) as number);
}
