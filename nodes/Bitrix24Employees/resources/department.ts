import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows, listAll } from '../../../shared/list';
import { compact, returnAllProperties } from '../../../shared/params';
import { numberProperty, stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { limitOf, optionalId, requiredId } from '../shared/helpers';

const departmentIdProperty = numberProperty(
	'Department ID',
	'departmentId',
	'ID of the department, as Get Many returns it in ID',
);

const headProperty: INodeProperties = {
	displayName: 'Head Employee ID',
	name: 'head',
	type: 'number',
	default: 0,
	description: 'Employee who heads the department. 0 leaves it without a head.',
};

const parentProperty: INodeProperties = {
	displayName: 'Parent Department ID',
	name: 'parent',
	type: 'number',
	default: 0,
	description: 'Department this one sits under. The company itself is the only one without a parent.',
};

const sortProperty: INodeProperties = {
	displayName: 'Sort Order',
	name: 'sort',
	type: 'number',
	default: 0,
	description: 'Position among the other departments of the same parent. Smaller comes first.',
};

export const departmentResource: Resource = {
	value: 'department',
	name: 'Department',
	description: 'The company structure: departments, who heads them and what they sit under',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a department',
			description: 'Add a department under another one. A portal has exactly one top-level department.',
			properties: [
				stringProperty('Name', 'name', 'Name of the department', true),
				{ ...parentProperty, required: true },
				headProperty,
				sortProperty,
			],
			async execute(itemIndex) {
				const params = compact({
					NAME: this.getNodeParameter('name', itemIndex),
					PARENT: requiredId(this, 'parent', itemIndex, 'Parent Department ID'),
					UF_HEAD: optionalId(this, 'head', itemIndex),
					SORT: optionalId(this, 'sort', itemIndex),
				});
				const body = await bitrix24Request.call(this, 'department.add', params, { itemIndex });
				return { id: Number(body.result) };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a department',
			description: 'Retrieve one department by ID, with its parent and its head',
			properties: [departmentIdProperty],
			async execute(itemIndex) {
				const id = requiredId(this, 'departmentId', itemIndex, 'Department ID');
				const body = await bitrix24Request.call(this, 'department.get', { ID: id }, { itemIndex });
				const rows = extractRows(body.result);
				if (rows.length === 0) {
					throw new NodeOperationError(this.getNode(), `Bitrix24 has no department ${id}`, { itemIndex });
				}
				return rows[0];
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many departments',
			description: 'List the departments of the company structure, optionally under one parent',
			properties: [
				...returnAllProperties('departments'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{
							displayName: 'Head Employee ID',
							name: 'UF_HEAD',
							type: 'number',
							default: 0,
							description: 'Only departments headed by this employee',
						},
						{
							displayName: 'Name',
							name: 'NAME',
							type: 'string',
							default: '',
							description: 'Exact name of the department, not a part of it',
						},
						{
							displayName: 'Parent Department ID',
							name: 'PARENT',
							type: 'number',
							default: 0,
							description: 'Only the departments directly under this one',
						},
					],
				},
				{
					displayName: 'Sort By',
					name: 'sort',
					type: 'options',
					default: 'SORT',
					options: [
						{ name: 'Head', value: 'UF_HEAD' },
						{ name: 'ID', value: 'ID' },
						{ name: 'Name', value: 'NAME' },
						{ name: 'Parent', value: 'PARENT' },
						{ name: 'Sort Order', value: 'SORT' },
					],
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
			],
			async execute(itemIndex) {
				const filters = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = compact({
					NAME: filters.NAME,
					PARENT: Number(filters.PARENT ?? 0) > 0 ? Number(filters.PARENT) : undefined,
					UF_HEAD: Number(filters.UF_HEAD ?? 0) > 0 ? Number(filters.UF_HEAD) : undefined,
					sort: this.getNodeParameter('sort', itemIndex, 'SORT'),
					order: this.getNodeParameter('order', itemIndex, 'ASC'),
				});
				return await listAll.call(this, 'department.get', params, { limit: limitOf(this, itemIndex), itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a department',
			description: 'Rename a department, move it under another one or change its head',
			properties: [
				departmentIdProperty,
				stringProperty('Name', 'name', 'New name of the department'),
				parentProperty,
				headProperty,
				sortProperty,
			],
			async execute(itemIndex) {
				const params = compact({
					ID: requiredId(this, 'departmentId', itemIndex, 'Department ID'),
					NAME: this.getNodeParameter('name', itemIndex, ''),
					PARENT: optionalId(this, 'parent', itemIndex),
					UF_HEAD: optionalId(this, 'head', itemIndex),
					SORT: optionalId(this, 'sort', itemIndex),
				});
				if (Object.keys(params).length <= 1) {
					throw new NodeOperationError(this.getNode(), 'No field to change', { itemIndex });
				}
				await bitrix24Request.call(this, 'department.update', params, { itemIndex });
				return undefined;
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a department',
			description: 'Remove a department. Its employees stay on the portal without it.',
			properties: [departmentIdProperty],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'department.delete',
					{ ID: requiredId(this, 'departmentId', itemIndex, 'Department ID') },
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the fields of a department',
			description: 'Describe the fields a department has',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'department.fields', {}, { itemIndex });
				const fields = (body.result ?? {}) as IDataObject;
				return Object.entries(fields).map(([name, meta]) =>
					meta !== null && typeof meta === 'object' ? { name, ...(meta as IDataObject) } : { name, type: meta as string },
				);
			},
		},
	],
};
