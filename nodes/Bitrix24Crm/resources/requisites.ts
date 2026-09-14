import type { IDataObject } from 'n8n-workflow';

import { crudOperations } from '../../../shared/crud';
import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows } from '../shared/props';

export const requisiteResource: Resource = {
	value: 'requisite',
	name: 'Requisite',
	description: 'Legal and tax details of companies and contacts',
	operations: crudOperations({
		prefix: 'crm.requisite',
		noun: 'requisite',
		plural: 'requisites',
		listIdField: 'ID',
		fieldsExample: '{"ENTITY_TYPE_ID": 4, "ENTITY_ID": 10, "PRESET_ID": 1, "NAME": "Main", "RQ_COMPANY_NAME": "Acme LLC"}',
		descriptions: {
			create: 'Add requisites to a company (ENTITY_TYPE_ID 4) or contact (3), based on a requisite template',
			getMany: 'List requisites; filter by owner with {"ENTITY_TYPE_ID": 4, "ENTITY_ID": 10}',
		},
	}),
};

export const bankDetailResource: Resource = {
	value: 'bankDetail',
	name: 'Bank Detail',
	description: 'Bank accounts attached to a requisite',
	operations: crudOperations({
		prefix: 'crm.requisite.bankdetail',
		noun: 'bank detail',
		plural: 'bank details',
		listIdField: 'ID',
		fieldsExample: '{"ENTITY_ID": 27, "NAME": "Main account", "RQ_BANK_NAME": "Bank", "RQ_ACC_NUM": "40702810000000000000"}',
		descriptions: { create: 'Add a bank account to a requisite (ENTITY_ID is the requisite ID)' },
	}),
};

const addressKeysExample = '{"TYPE_ID": 1, "ENTITY_TYPE_ID": 8, "ENTITY_ID": 27}';

export const addressResource: Resource = {
	value: 'address',
	name: 'Address',
	description: 'Addresses of requisites, companies, contacts and leads',
	operations: [
		...crudOperations({
			prefix: 'crm.address',
			noun: 'address',
			plural: 'addresses',
			kinds: ['create', 'getMany', 'getFields'],
			fieldsExample: '{"TYPE_ID": 1, "ENTITY_TYPE_ID": 8, "ENTITY_ID": 27, "CITY": "Berlin", "ADDRESS_1": "Main St 1"}',
			descriptions: {
				create: 'Add an address. TYPE_ID is the address type, ENTITY_TYPE_ID 8 means a requisite.',
				getMany: 'List addresses; filter by owner with {"ENTITY_TYPE_ID": 8, "ENTITY_ID": 27}',
			},
		}),
		{
			value: 'update',
			name: 'Update',
			action: 'Update an address',
			description: 'Change an address. It is identified by type and owner rather than by ID, so those keys must be in the fields.',
			properties: [jsonProperty('Fields (JSON)', 'fieldsJson', `Address fields including its key, e.g. {"TYPE_ID": 1, "ENTITY_TYPE_ID": 8, "ENTITY_ID": 27, "CITY": "Hamburg"}`)],
			async execute(itemIndex) {
				const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});
				await bitrix24Request.call(this, 'crm.address.update', { fields }, { itemIndex });
				return { updated: true, ...fields };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete an address',
			description: 'Remove an address, identified by its type and owner',
			properties: [jsonProperty('Address Key (JSON)', 'fieldsJson', `Type and owner of the address, e.g. ${addressKeysExample}`)],
			async execute(itemIndex) {
				const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});
				await bitrix24Request.call(this, 'crm.address.delete', { fields }, { itemIndex });
				return { deleted: true, ...fields };
			},
		},
	],
};

const linkOwner = [
	entityTypeProperty('Type of the record the requisites are chosen for — deal, quote, invoice or smart process item'),
	numberProperty('Record ID', 'entityId', 'ID of that record'),
];

export const requisiteLinkResource: Resource = {
	value: 'requisiteLink',
	name: 'Requisite Link',
	description: 'Which client and own-company requisites a deal, quote or invoice uses',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get the requisites chosen for a record',
			description: 'Read which client and own-company requisites and bank details a record uses',
			properties: linkOwner,
			async execute(itemIndex) {
				const params = { entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'), entityId: positiveInt(this, 'entityId', itemIndex, 'Record ID') };
				const body = await bitrix24Request.call(this, 'crm.requisite.link.get', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many requisite links',
			description: 'List requisite links, e.g. every record that uses one requisite',
			properties: [
				...returnAllProperties('links'),
				jsonProperty('Filter (JSON)', 'filterJson', 'Filter, e.g. {"REQUISITE_ID": 27} or {"ENTITY_TYPE_ID": 2}'),
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				return await listAll.call(this, 'crm.requisite.link.list', Object.keys(filter).length > 0 ? { filter } : {}, { limit, itemIndex });
			},
		},
		{
			value: 'set',
			name: 'Set',
			action: 'Choose the requisites for a record',
			description: 'Set which client and own-company requisites and bank details a record uses. The record must already have its client company or contact set.',
			properties: [
				...linkOwner,
				jsonProperty('Links (JSON)', 'linkJson', 'IDs to use, 0 for none, e.g. {"REQUISITE_ID": 27, "BANK_DETAIL_ID": 5, "MC_REQUISITE_ID": 1, "MC_BANK_DETAIL_ID": 1}'),
			],
			async execute(itemIndex) {
				const fields = {
					...jsonParameter<IDataObject>(this, 'linkJson', itemIndex, {}),
					ENTITY_TYPE_ID: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'),
					ENTITY_ID: positiveInt(this, 'entityId', itemIndex, 'Record ID'),
				};
				await bitrix24Request.call(this, 'crm.requisite.link.register', { fields }, { itemIndex });
				return { linked: true, ...fields };
			},
		},
		{
			value: 'remove',
			name: 'Remove',
			action: 'Clear the requisites of a record',
			description: 'Remove the requisite choice of a record',
			properties: linkOwner,
			async execute(itemIndex) {
				const params = { entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'), entityId: positiveInt(this, 'entityId', itemIndex, 'Record ID') };
				await bitrix24Request.call(this, 'crm.requisite.link.unregister', params, { itemIndex });
				return { removed: true, ...params };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get requisite link fields',
			description: 'Describe the fields of a requisite link',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.requisite.link.fields', {}, { itemIndex });
				return Object.entries((body.result ?? {}) as IDataObject).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
	],
};

export const requisiteTemplateResource: Resource = {
	value: 'requisiteTemplate',
	name: 'Requisite Template',
	description: 'Templates (presets) that define which fields a requisite has, per country',
	operations: crudOperations({
		prefix: 'crm.requisite.preset',
		noun: 'requisite template',
		plural: 'requisite templates',
		listIdField: 'ID',
		fieldsExample: '{"ENTITY_TYPE_ID": 8, "COUNTRY_ID": 1, "NAME": "Sole trader", "ACTIVE": "Y"}',
	}),
};

const presetId = numberProperty('Template ID', 'presetId', 'ID of the requisite template');

export const requisiteTemplateFieldResource: Resource = {
	value: 'requisiteTemplateField',
	name: 'Requisite Template Field',
	description: 'The fields a requisite template contains',
	operations: [
		...crudOperations({
			prefix: 'crm.requisite.preset.field',
			noun: 'template field',
			plural: 'template fields',
			context: [presetId],
			contextParams: (ctx, i) => ({ preset: { ID: positiveInt(ctx, 'presetId', i, 'Template ID') } }),
			listParams: [],
			fieldsExample: '{"FIELD_NAME": "RQ_INN", "FIELD_TITLE": "Tax number", "SORT": 100, "IN_SHORT_LIST": "Y"}',
		}),
		{
			value: 'getAvailable',
			name: 'Get Available to Add',
			action: 'Get fields a template can still take',
			description: 'List the field names that can still be added to a requisite template',
			properties: [presetId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.requisite.preset.field.availabletoadd', { preset: { ID: positiveInt(this, 'presetId', itemIndex, 'Template ID') } }, { itemIndex });
				return rows(body.result);
			},
		},
	],
};
