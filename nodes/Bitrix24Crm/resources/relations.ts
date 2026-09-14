import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, jsonParameter, stringList } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows } from '../shared/props';

interface LinkConfig {
	value: string;
	name: string;
	description: string;
	/** The Record Type picker: which records the links hang off. */
	ownerProperty: INodeProperties;
	/** crm.<owner>.<linked> — contact or company. */
	linked: 'contact' | 'company';
	idKey: 'CONTACT_ID' | 'COMPANY_ID';
}

function linkResource(config: LinkConfig): Resource {
	const noun = config.linked;
	const owner: INodeProperties[] = [
		config.ownerProperty,
		numberProperty('Record ID', 'ownerId', 'ID of the record the links belong to'),
	];
	const method = (ctx: IExecuteFunctions, itemIndex: number, suffix: string): string =>
		`crm.${String(ctx.getNodeParameter('linkOwner', itemIndex))}.${config.linked}.${suffix}`;
	const ownerId = (ctx: IExecuteFunctions, itemIndex: number): number => positiveInt(ctx, 'ownerId', itemIndex, 'Record ID');
	const linkedId = numberProperty(`${noun[0].toUpperCase()}${noun.slice(1)} ID`, 'linkedId', `ID of the ${noun}`);

	return {
		value: config.value,
		name: config.name,
		description: config.description,
		operations: [
			{
				value: 'add',
				name: 'Add',
				action: `Link a ${noun} to a record`,
				description: `Link one more ${noun} to a record, optionally as the primary one`,
				properties: [
					...owner,
					linkedId,
					{ displayName: 'Primary', name: 'isPrimary', type: 'boolean', default: false, description: `Whether this ${noun} becomes the primary one` },
					{ displayName: 'Sort', name: 'sort', type: 'number', default: 0, description: 'Position among the links; 0 leaves it to Bitrix24' },
				],
				async execute(itemIndex) {
					const fields = compact({
						[config.idKey]: positiveInt(this, 'linkedId', itemIndex, `${noun} ID`),
						IS_PRIMARY: (this.getNodeParameter('isPrimary', itemIndex) as boolean) ? 'Y' : 'N',
						SORT: Number(this.getNodeParameter('sort', itemIndex)) || undefined,
					});
					await bitrix24Request.call(this, method(this, itemIndex, 'add'), { id: ownerId(this, itemIndex), fields }, { itemIndex });
					return { linked: true, ...fields };
				},
			},
			{
				value: 'remove',
				name: 'Remove',
				action: `Unlink a ${noun} from a record`,
				description: `Remove one ${noun} from the links of a record; the ${noun} itself stays`,
				properties: [...owner, linkedId],
				async execute(itemIndex) {
					const fields = { [config.idKey]: positiveInt(this, 'linkedId', itemIndex, `${noun} ID`) };
					await bitrix24Request.call(this, method(this, itemIndex, 'delete'), { id: ownerId(this, itemIndex), fields }, { itemIndex });
					return { unlinked: true, ...fields };
				},
			},
			{
				value: 'getMany',
				name: 'Get Many',
				action: `Get the ${noun === 'company' ? 'companies' : 'contacts'} linked to a record`,
				description: `List the ${noun === 'company' ? 'companies' : 'contacts'} linked to a record with their order and primary flag`,
				properties: owner,
				async execute(itemIndex) {
					const body = await bitrix24Request.call(this, method(this, itemIndex, 'items.get'), { id: ownerId(this, itemIndex) }, { itemIndex });
					return rows(body.result);
				},
			},
			{
				value: 'setAll',
				name: 'Replace All',
				action: `Replace the ${noun === 'company' ? 'companies' : 'contacts'} of a record`,
				description: `Overwrite the whole list of linked ${noun === 'company' ? 'companies' : 'contacts'}; an empty list removes them all`,
				properties: [
					...owner,
					jsonProperty(
						'Links (JSON)',
						'items',
						`Array of links, e.g. [{"${config.idKey}": 5, "IS_PRIMARY": "Y"}, {"${config.idKey}": 9, "SORT": 20}]`,
						'[]',
					),
				],
				async execute(itemIndex) {
					const items = jsonParameter<IDataObject[]>(this, 'items', itemIndex, []);
					if (!Array.isArray(items)) {
						throw new NodeOperationError(this.getNode(), 'Links (JSON) must be an array', { itemIndex });
					}
					await bitrix24Request.call(this, method(this, itemIndex, 'items.set'), { id: ownerId(this, itemIndex), items }, { itemIndex });
					return { replaced: true, count: items.length };
				},
			},
			{
				value: 'removeAll',
				name: 'Remove All',
				action: `Unlink every ${noun} from a record`,
				description: `Remove all linked ${noun === 'company' ? 'companies' : 'contacts'} from a record`,
				properties: owner,
				async execute(itemIndex) {
					await bitrix24Request.call(this, method(this, itemIndex, 'items.delete'), { id: ownerId(this, itemIndex) }, { itemIndex });
					return { unlinked: true };
				},
			},
		],
	};
}

export const linkedContactResource = linkResource({
	value: 'linkedContact',
	name: 'Linked Contact',
	description: 'Contacts linked to a lead, deal, quote or company',
	ownerProperty: {
		displayName: 'Record Type',
		name: 'linkOwner',
		type: 'options',
		default: 'deal',
		options: [
			{ name: 'Company', value: 'company' },
			{ name: 'Deal', value: 'deal' },
			{ name: 'Lead', value: 'lead' },
			{ name: 'Quote', value: 'quote' },
		],
	},
	linked: 'contact',
	idKey: 'CONTACT_ID',
});

export const linkedCompanyResource = linkResource({
	value: 'linkedCompany',
	name: 'Linked Company',
	description: 'Companies a contact works for',
	ownerProperty: {
		displayName: 'Record Type',
		name: 'linkOwner',
		type: 'options',
		default: 'contact',
		options: [{ name: 'Contact', value: 'contact' }],
	},
	linked: 'company',
	idKey: 'COMPANY_ID',
});

export const duplicateResource: Resource = {
	value: 'duplicate',
	name: 'Duplicate',
	description: 'Finding records by phone or e-mail and tuning duplicate search',
	operations: [
		{
			value: 'findByCommunication',
			name: 'Find by Phone or Email',
			action: 'Find records by phone or email',
			description: 'Find leads, contacts and companies that have one of the given phone numbers or e-mail addresses — the usual check before creating a new client',
			properties: [
				{
					displayName: 'Search By',
					name: 'communicationType',
					type: 'options',
					default: 'PHONE',
					options: [
						{ name: 'Email', value: 'EMAIL' },
						{ name: 'Phone', value: 'PHONE' },
					],
				},
				{
					displayName: 'Values',
					name: 'values',
					type: 'string',
					required: true,
					default: '',
					placeholder: '+4930123456, +4930654321',
					description: 'Comma-separated phone numbers or e-mail addresses, up to 20',
				},
				{
					displayName: 'Only In',
					name: 'onlyIn',
					type: 'options',
					default: '',
					options: [
						{ name: 'All Types', value: '' },
						{ name: 'Companies', value: 'COMPANY' },
						{ name: 'Contacts', value: 'CONTACT' },
						{ name: 'Leads', value: 'LEAD' },
					],
				},
			],
			async execute(itemIndex) {
				const values = stringList(this.getNodeParameter('values', itemIndex));
				if (values.length === 0 || values.length > 20) {
					throw new NodeOperationError(this.getNode(), 'Give between 1 and 20 values to search for', { itemIndex });
				}
				const params = compact({
					type: this.getNodeParameter('communicationType', itemIndex) as string,
					values,
					entity_type: this.getNodeParameter('onlyIn', itemIndex, '') as string,
				});
				const body = await bitrix24Request.call(this, 'crm.duplicate.findbycomm', params, { itemIndex });
				// Bitrix24 answers [] when nothing matched and {CONTACT: [ids]} otherwise.
				const found = Array.isArray(body.result) ? {} : ((body.result ?? {}) as IDataObject);
				return {
					leads: (found.LEAD ?? []) as number[],
					contacts: (found.CONTACT ?? []) as number[],
					companies: (found.COMPANY ?? []) as number[],
					found: Object.values(found).some((ids) => Array.isArray(ids) && ids.length > 0),
				};
			},
		},
		{
			value: 'getSearchFields',
			name: 'Get Extra Search Fields',
			action: 'Get the fields added to duplicate search',
			description: 'List the extra fields the duplicate search also compares',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.duplicate.volatileType.list', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getAvailableSearchFields',
			name: 'Get Addable Search Fields',
			action: 'Get fields that can be added to duplicate search',
			description: 'List the fields of a CRM type that can be added to duplicate search',
			properties: [entityTypeProperty('Type of record')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.duplicate.volatileType.fields', { entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'addSearchField',
			name: 'Add Search Field',
			action: 'Add a field to duplicate search',
			description: 'Make duplicate search also compare one more field, e.g. a tax number',
			properties: [
				entityTypeProperty('Type of record'),
				{ displayName: 'Field Code', name: 'fieldCode', type: 'string', required: true, default: '', placeholder: 'UF_CRM_1700000000' },
			],
			async execute(itemIndex) {
				const params = { entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'), fieldCode: String(this.getNodeParameter('fieldCode', itemIndex)).trim() };
				const body = await bitrix24Request.call(this, 'crm.duplicate.volatileType.register', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'removeSearchField',
			name: 'Remove Search Field',
			action: 'Remove a field from duplicate search',
			description: 'Stop duplicate search comparing a field added earlier',
			properties: [numberProperty('Search Field ID', 'searchFieldId', 'ID from Get Extra Search Fields')],
			async execute(itemIndex) {
				const id = positiveInt(this, 'searchFieldId', itemIndex, 'Search Field ID');
				await bitrix24Request.call(this, 'crm.duplicate.volatileType.unregister', { id }, { itemIndex });
				return { id, removed: true };
			},
		},
	],
};
