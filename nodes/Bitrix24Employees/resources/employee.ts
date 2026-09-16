import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows, listAll } from '../../../shared/list';
import { compact, returnAllProperties, stringList } from '../../../shared/params';
import { stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import {
	adminModeProperty,
	employeeBody,
	employeeFieldsProperty,
	employeeFilter,
	employeeFilterJsonProperty,
	employeeFilterProperty,
	employeeJsonProperty,
	limitOf,
	readingOptions,
	requiredId,
	selectProperty,
	sortProperties,
	userIdProperty,
} from '../shared/helpers';

/** user.fields answers {NAME: {type, isRequired, …}}: one row per field. */
function fieldRows(result: unknown): IDataObject[] {
	const fields = (result ?? {}) as IDataObject;
	return Object.entries(fields).map(([name, meta]) => {
		if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) return { name, ...(meta as IDataObject) };
		return { name, title: meta as string };
	});
}

export const employeeResource: Resource = {
	value: 'employee',
	name: 'Employee',
	description: 'The people on the portal: who they are, where they work and how to reach them',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get an employee',
			description: 'Retrieve one employee by ID',
			properties: [userIdProperty, selectProperty, adminModeProperty],
			async execute(itemIndex) {
				const id = requiredId(this, 'userId', itemIndex, 'Employee ID');
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				const params: IDataObject = compact({
					ID: id,
					select: select.length > 0 ? select : undefined,
					ADMIN_MODE: (this.getNodeParameter('adminMode', itemIndex, false) as boolean) ? true : undefined,
				});
				const body = await bitrix24Request.call(this, 'user.get', params, { itemIndex });
				const rows = extractRows(body.result);
				if (rows.length === 0) {
					throw new NodeOperationError(this.getNode(), `Bitrix24 has no employee ${id}`, {
						itemIndex,
						description:
							'The ID may belong to a bot, a mail user or an extranet user, which this method leaves out, or the webhook cannot see it.',
					});
				}
				return rows[0];
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many employees',
			description: 'List employees, filtered by department, activity, name or any field of theirs',
			properties: [
				...returnAllProperties('employees'),
				employeeFilterProperty,
				employeeFilterJsonProperty,
				selectProperty,
				...sortProperties,
				adminModeProperty,
			],
			async execute(itemIndex) {
				const params: IDataObject = {
					...employeeFilter(this, itemIndex),
					...readingOptions(this, itemIndex),
				};
				return await listAll.call(this, 'user.get', params, { limit: limitOf(this, itemIndex), itemIndex });
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search employees',
			description:
				'Find employees by one search phrase across names and job titles, or by those fields one by one',
			properties: [
				...returnAllProperties('employees'),
				stringProperty('Search For', 'find', 'Looked for in the first name, last name, job title and department name'),
				{
					displayName: 'Search Fields',
					name: 'searchFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					description: 'Search field by field instead. Bitrix24 takes either this or Search For, never both.',
					options: [
						{ displayName: 'Department Name', name: 'UF_DEPARTMENT_NAME', type: 'string', default: '' },
						{ displayName: 'First Name', name: 'NAME', type: 'string', default: '' },
						{ displayName: 'Job Title', name: 'WORK_POSITION', type: 'string', default: '' },
						{ displayName: 'Last Name', name: 'LAST_NAME', type: 'string', default: '' },
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
				},
				selectProperty,
				...sortProperties,
				adminModeProperty,
			],
			async execute(itemIndex) {
				const find = String(this.getNodeParameter('find', itemIndex, '')).trim();
				const fields = compact((this.getNodeParameter('searchFields', itemIndex, {}) ?? {}) as IDataObject);

				if (find !== '' && Object.keys(fields).length > 0) {
					throw new NodeOperationError(this.getNode(), 'Use either Search For or Search Fields', {
						itemIndex,
						description: 'Bitrix24 works with FIND alone or with the named fields alone, not with both.',
					});
				}
				if (find === '' && Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to search for', {
						itemIndex,
						description: 'Fill in Search For, or add at least one field under Search Fields.',
					});
				}

				const params: IDataObject = {
					...(find === '' ? fields : { FIND: find }),
					...readingOptions(this, itemIndex),
				};
				return await listAll.call(this, 'user.search', params, { limit: limitOf(this, itemIndex), itemIndex });
			},
		},
		{
			value: 'getCurrent',
			name: 'Get Current',
			action: 'Get the employee the webhook acts as',
			description: 'Retrieve the account the webhook was created by, with its ID and time zone',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'user.current', {}, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'invite',
			name: 'Invite',
			action: 'Invite an employee',
			description:
				'Add an employee and send them the standard invitation email. Needs an administrator webhook, and an intranet employee needs a department.',
			properties: [
				{
					displayName: 'Email',
					name: 'email',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'name@example.com',
					description: 'Address the invitation goes to. It has to be free on the portal.',
				},
				employeeFieldsProperty(false),
				employeeJsonProperty,
			],
			async execute(itemIndex) {
				const extra = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const params = employeeBody(this, itemIndex, { EMAIL: this.getNodeParameter('email', itemIndex), ...extra });
				const body = await bitrix24Request.call(this, 'user.add', params, { itemIndex });
				return { id: Number(body.result) };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update an employee',
			description:
				'Change the data of an employee, including dismissing them with Active off. Needs an administrator webhook.',
			properties: [userIdProperty, employeeFieldsProperty(true), employeeJsonProperty],
			async execute(itemIndex) {
				const fields = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const params = employeeBody(this, itemIndex, {
					ID: requiredId(this, 'userId', itemIndex, 'Employee ID'),
					...fields,
				});
				if (Object.keys(params).length <= 1) {
					throw new NodeOperationError(this.getNode(), 'No field to change', {
						itemIndex,
						description: 'Add at least one field, or write it into Fields (JSON).',
					});
				}
				await bitrix24Request.call(this, 'user.update', params, { itemIndex });
				return undefined;
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the fields of an employee',
			description: 'Describe every employee field the webhook can read or write, custom ones included',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'user.fields', {}, { itemIndex });
				return fieldRows(body.result);
			},
		},
	],
};
