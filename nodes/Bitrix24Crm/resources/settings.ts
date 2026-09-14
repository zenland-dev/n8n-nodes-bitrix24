import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { crudOperations } from '../../../shared/crud';
import { jsonParameter, stringList } from '../../../shared/params';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeProperty, jsonProperty, positiveInt, rows, stringProperty } from '../shared/props';

const entityType = entityTypeProperty('Type of CRM record');

export const pipelineResource: Resource = {
	value: 'pipeline',
	name: 'Pipeline',
	description: 'Pipelines (categories) of deals, invoices and smart processes',
	operations: crudOperations({
		prefix: 'crm.category',
		noun: 'pipeline',
		plural: 'pipelines',
		context: [entityTypeProperty('Type of record the pipelines belong to — deals or a smart process with pipelines enabled')],
		contextParams: (ctx, i) => ({ entityTypeId: positiveInt(ctx, 'entityTypeId', i, 'Entity type') }),
		resultKey: 'category',
		listKey: 'categories',
		minId: 0,
		listParams: [],
		fieldsExample: '{"name": "Partners", "sort": 500}',
		descriptions: {
			create: 'Create a pipeline; Bitrix24 gives it the default set of stages',
			delete: 'Delete a pipeline. Bitrix24 refuses while it still holds records.',
		},
	}),
};

const statusOperations: Operation[] = [
	...crudOperations({
		prefix: 'crm.status',
		noun: 'reference entry',
		plural: 'reference entries',
		listIdField: 'ID',
		listParams: ['filter', 'order'],
		fieldsExample: '{"ENTITY_ID": "SOURCE", "STATUS_ID": "PARTNER", "NAME": "Partner", "SORT": 100}',
		descriptions: {
			create: 'Add an entry to a reference book — a stage, a source, a contact type…',
			getMany: 'List entries of reference books; filter by ENTITY_ID, e.g. {"ENTITY_ID": "DEAL_STAGE_3"}',
			delete: 'Delete a reference entry. System entries are refused.',
		},
	}),
	{
		value: 'getBooks',
		name: 'Get Reference Books',
		action: 'Get the reference books',
		description: 'List every reference book of the portal — stages per pipeline, sources, contact types, industries — with its ENTITY_ID',
		async execute(itemIndex) {
			const body = await bitrix24Request.call(this, 'crm.status.entity.types', {}, { itemIndex });
			return rows(body.result);
		},
	},
	{
		value: 'getBookEntries',
		name: 'Get Book Entries',
		action: 'Get the entries of a reference book',
		description: 'List the entries of one reference book in their display order',
		properties: [stringProperty('Book ID', 'bookId', 'ENTITY_ID of the book, e.g. SOURCE, DEAL_STAGE or DEAL_STAGE_3', true, 'SOURCE')],
		async execute(itemIndex) {
			const entityId = String(this.getNodeParameter('bookId', itemIndex)).trim();
			const body = await bitrix24Request.call(this, 'crm.status.entity.items', { entityId }, { itemIndex });
			return rows(body.result);
		},
	},
];

export const statusResource: Resource = {
	value: 'status',
	name: 'Reference Book',
	description: 'Stages, sources, contact types and the other lists CRM fields pick from',
	operations: statusOperations,
};

export const smartProcessTypeResource: Resource = {
	value: 'smartProcessType',
	name: 'Smart Process Type',
	description: 'Smart processes themselves: their names and which features they have',
	operations: [
		...crudOperations({
			prefix: 'crm.type',
			noun: 'smart process',
			plural: 'smart processes',
			resultKey: 'type',
			listKey: 'types',
			listParams: ['filter', 'order'],
			fieldsExample: '{"title": "Applications", "isCategoriesEnabled": "Y", "isStagesEnabled": "Y"}',
			descriptions: {
				get: 'Retrieve a smart process type by its own ID (not the entity type ID)',
				delete: 'Delete a smart process type. Bitrix24 refuses while it still holds items.',
			},
		}),
		{
			value: 'getByEntityTypeId',
			name: 'Get by Entity Type ID',
			action: 'Get a smart process by entity type ID',
			description: 'Retrieve a smart process type by the entity type ID its items use (1000 and above)',
			properties: [{ displayName: 'Entity Type ID', name: 'spaEntityTypeId', type: 'number', required: true, default: 1030 }],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.type.getByEntityTypeId', { entityTypeId: positiveInt(this, 'spaEntityTypeId', itemIndex, 'Entity Type ID') }, { itemIndex });
				return rows(body.result, 'type');
			},
		},
	],
};

const USERFIELD_OWNERS = [
	{ name: 'Company', value: 'company' },
	{ name: 'Contact', value: 'contact' },
	{ name: 'Deal', value: 'deal' },
	{ name: 'Lead', value: 'lead' },
	{ name: 'Quote', value: 'quote' },
	{ name: 'Requisite', value: 'requisite' },
];

const customFieldOperations: Operation[] = [
	...crudOperations({
		// One set of operations serves every owner; only the method prefix changes.
		prefix: (ctx, i) => `crm.${String(ctx.getNodeParameter('fieldOwner', i))}.userfield`,
		noun: 'custom field',
		plural: 'custom fields',
		kinds: ['create', 'get', 'getMany', 'update', 'delete'],
		context: [
			{
				displayName: 'Of',
				name: 'fieldOwner',
				type: 'options',
				default: 'deal',
				options: USERFIELD_OWNERS,
				description: 'Which records the field belongs to. For smart process fields use Custom Field Config.',
			},
		],
		listParams: ['filter', 'order'],
		fieldsExample: '{"FIELD_NAME": "PARTNER_CODE", "USER_TYPE_ID": "string", "EDIT_FORM_LABEL": {"en": "Partner code"}}',
		descriptions: {
			create: 'Create a custom field. Bitrix24 prefixes the name with UF_CRM_.',
			delete: 'Delete a custom field together with every value stored in it',
		},
	}),
];

export const customFieldResource: Resource = {
	value: 'customField',
	name: 'Custom Field',
	description: 'Custom (UF_CRM_…) fields of leads, deals, contacts, companies, quotes and requisites',
	operations: customFieldOperations,
};

export const userFieldConfigResource: Resource = {
	value: 'userFieldConfig',
	name: 'Custom Field Config',
	description: 'Custom fields of any CRM type through the universal userfieldconfig methods, smart processes included',
	operations: [
		...crudOperations({
			prefix: 'userfieldconfig',
			noun: 'field config',
			plural: 'field configs',
			context: [stringProperty('Module ID', 'moduleId', 'Module the field lives in; crm for CRM fields', true, 'crm')],
			contextParams: (ctx, i) => ({ moduleId: String(ctx.getNodeParameter('moduleId', i)).trim() || 'crm' }),
			kinds: ['create', 'get', 'getMany', 'update', 'delete'],
			fieldsKey: 'field',
			resultKey: 'field',
			listKey: 'fields',
			listParams: ['select', 'filter', 'order'],
			fieldsExample: '{"entityId": "CRM_7", "fieldName": "UF_CRM_7_RATING", "userTypeId": "integer", "editFormLabel": {"en": "Rating"}}',
		}),
		{
			value: 'getTypes',
			name: 'Get Field Types',
			action: 'Get the custom field types',
			description: 'List the custom field types a module accepts, including types added by applications',
			properties: [stringProperty('Module ID', 'moduleId', 'Module the field lives in; crm for CRM fields', true, 'crm')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'userfieldconfig.getTypes', { moduleId: String(this.getNodeParameter('moduleId', itemIndex)).trim() || 'crm' }, { itemIndex });
				return keyedRows(((body.result ?? {}) as IDataObject).types, 'type');
			},
		},
	],
};

export const currencyResource: Resource = {
	value: 'currency',
	name: 'Currency',
	description: 'Currencies, their rates against the base currency and display formats',
	operations: [
		...crudOperations({
			prefix: 'crm.currency',
			noun: 'currency',
			plural: 'currencies',
			idType: 'string',
			idKeys: { update: 'ID' },
			listParams: ['order'],
			fieldsExample: '{"CURRENCY": "AED", "AMOUNT": 21.5, "AMOUNT_CNT": 1, "SORT": 500}',
			descriptions: { get: 'Retrieve a currency by its code, e.g. EUR' },
		}),
		{
			value: 'getBase',
			name: 'Get Base Currency',
			action: 'Get the base currency',
			description: 'Return the code of the currency all rates are relative to',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.currency.base.get', {}, { itemIndex });
				return { currency: body.result as string };
			},
		},
		{
			value: 'setBase',
			name: 'Set Base Currency',
			action: 'Set the base currency',
			description: 'Make another currency the base one that rates are counted against',
			properties: [stringProperty('Currency Code', 'currencyCode', 'Code of the currency, e.g. EUR', true, 'EUR')],
			async execute(itemIndex) {
				const id = String(this.getNodeParameter('currencyCode', itemIndex)).trim();
				await bitrix24Request.call(this, 'crm.currency.base.set', { id }, { itemIndex });
				return { currency: id, base: true };
			},
		},
		{
			value: 'getLocalizations',
			name: 'Get Localizations',
			action: 'Get currency localizations',
			description: 'Read how a currency is named and formatted in each interface language',
			properties: [stringProperty('Currency Code', 'currencyCode', 'Code of the currency, e.g. EUR', true, 'EUR')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.currency.localizations.get', { id: String(this.getNodeParameter('currencyCode', itemIndex)).trim() }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'setLocalizations',
			name: 'Set Localizations',
			action: 'Set currency localizations',
			description: 'Set the name and format of a currency per interface language',
			properties: [
				stringProperty('Currency Code', 'currencyCode', 'Code of the currency, e.g. EUR', true, 'EUR'),
				jsonProperty('Localizations (JSON)', 'localizations', 'Per language, e.g. {"en": {"FULL_NAME": "Euro", "FORMAT_STRING": "&euro;#", "DEC_POINT": "."}}'),
			],
			async execute(itemIndex) {
				const id = String(this.getNodeParameter('currencyCode', itemIndex)).trim();
				const localizations = jsonParameter<IDataObject>(this, 'localizations', itemIndex, {});
				await bitrix24Request.call(this, 'crm.currency.localizations.set', { id, localizations }, { itemIndex });
				return { currency: id, updated: true };
			},
		},
		{
			value: 'deleteLocalizations',
			name: 'Delete Localizations',
			action: 'Delete currency localizations',
			description: 'Remove the name and format of a currency for some languages',
			properties: [
				stringProperty('Currency Code', 'currencyCode', 'Code of the currency, e.g. EUR', true, 'EUR'),
				stringProperty('Languages', 'lids', 'Comma-separated language codes, e.g. de, fr', true, 'de, fr'),
			],
			async execute(itemIndex) {
				const id = String(this.getNodeParameter('currencyCode', itemIndex)).trim();
				const lids = stringList(this.getNodeParameter('lids', itemIndex));
				await bitrix24Request.call(this, 'crm.currency.localizations.delete', { id, lids }, { itemIndex });
				return { currency: id, deleted: lids };
			},
		},
	],
};

export const automatedSolutionResource: Resource = {
	value: 'automatedSolution',
	name: 'Digital Workplace',
	description: 'Digital workplaces (automated solutions) that group smart processes into a section',
	operations: crudOperations({
		prefix: 'crm.automatedsolution',
		noun: 'digital workplace',
		plural: 'digital workplaces',
		resultKey: 'automatedSolution',
		listKey: 'automatedSolutions',
		listParams: ['filter', 'order'],
		fieldsExample: '{"title": "Visa Desk", "typeIds": [1030, 1034]}',
	}),
};

const cardScope: INodeProperties[] = [
	entityType,
	{
		displayName: 'Scope',
		name: 'cardScope',
		type: 'options',
		default: 'C',
		options: [
			{ name: 'Common (Everyone)', value: 'C' },
			{ name: 'Personal (One User)', value: 'P' },
		],
	},
	{
		displayName: 'User ID',
		name: 'cardUserId',
		type: 'number',
		default: 0,
		displayOptions: { show: { cardScope: ['P'] } },
		description: 'Whose personal layout. 0 means the user the webhook acts as.',
	},
	jsonProperty('Extras (JSON)', 'cardExtras', 'Which card variant, e.g. {"categoryId": 3} for a deal pipeline or {"leadCustomerType": 2} for repeat leads'),
];

/** entityTypeId, scope, userId and extras — what every card layout call starts from. */
function cardParams(ctx: IExecuteFunctions, itemIndex: number, withScope = true): IDataObject {
	const params: IDataObject = { entityTypeId: positiveInt(ctx, 'entityTypeId', itemIndex, 'Entity type') };
	if (withScope) {
		const scope = ctx.getNodeParameter('cardScope', itemIndex) as string;
		params.scope = scope;
		const userId = scope === 'P' ? Number(ctx.getNodeParameter('cardUserId', itemIndex, 0)) : 0;
		if (userId > 0) params.userId = userId;
	}
	const extras = jsonParameter<IDataObject>(ctx, 'cardExtras', itemIndex, {});
	if (Object.keys(extras).length > 0) params.extras = extras;
	return params;
}

export const cardConfigurationResource: Resource = {
	value: 'cardConfiguration',
	name: 'Card Layout',
	description: 'Which field sections the record card shows, common or per user',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get a card layout',
			description: 'Read the sections and fields of the record card',
			properties: cardScope,
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.details.configuration.get', cardParams(this, itemIndex), { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'set',
			name: 'Set',
			action: 'Set a card layout',
			description: 'Replace the sections and fields of the record card',
			properties: [...cardScope, jsonProperty('Sections (JSON)', 'cardData', 'Array of sections, e.g. [{"name": "main", "title": "About", "type": "section", "elements": [{"name": "TITLE"}]}]', '[]')],
			async execute(itemIndex) {
				const params = { ...cardParams(this, itemIndex), data: jsonParameter<IDataObject[]>(this, 'cardData', itemIndex, []) };
				await bitrix24Request.call(this, 'crm.item.details.configuration.set', params, { itemIndex });
				return { updated: true };
			},
		},
		{
			value: 'reset',
			name: 'Reset',
			action: 'Reset a card layout',
			description: 'Return the record card to the Bitrix24 default layout',
			properties: cardScope,
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'crm.item.details.configuration.reset', cardParams(this, itemIndex), { itemIndex });
				return { reset: true };
			},
		},
		{
			value: 'forceCommon',
			name: 'Force Common for All',
			action: 'Force the common card layout on everyone',
			description: 'Drop every personal layout so all users see the common one',
			properties: [entityType, jsonProperty('Extras (JSON)', 'cardExtras', 'Which card variant, e.g. {"categoryId": 3}')],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'crm.item.details.configuration.forceCommonScopeForAll', cardParams(this, itemIndex, false), { itemIndex });
				return { forced: true };
			},
		},
	],
};

interface DictionaryCall {
	value: string;
	name: string;
	method: string;
	description: string;
	/** The answer is a map of field name to description; return one row per field. */
	fieldMap?: boolean;
}

/** {a: {...}, b: {...}} as [{<key>: 'a', ...}, {<key>: 'b', ...}]. */
function keyedRows(value: unknown, key: string): IDataObject[] {
	if (value === null || typeof value !== 'object') return [];
	if (Array.isArray(value)) return value as IDataObject[];
	return Object.entries(value as IDataObject).map(([name, meta]) =>
		meta !== null && typeof meta === 'object' ? { [key]: name, ...(meta as IDataObject) } : { [key]: name, value: meta as string },
	);
}

const DICTIONARIES: DictionaryCall[] = [
	{ value: 'ownerTypes', name: 'Get Entity Types', method: 'crm.enum.ownertype', description: 'List CRM object types with their numeric IDs and symbolic codes, smart processes included' },
	{ value: 'addressTypes', name: 'Get Address Types', method: 'crm.enum.addresstype', description: 'List address types — actual, legal, registered…' },
	{ value: 'orderOwnerTypes', name: 'Get Order Owner Types', method: 'crm.enum.getorderownertypes', description: 'List the CRM types an online store order can be linked to' },
	{ value: 'settingsModes', name: 'Get CRM Modes', method: 'crm.enum.settings.mode', description: 'List the CRM modes: classic (with leads) and simple (without)' },
	{ value: 'currentMode', name: 'Get Current CRM Mode', method: 'crm.settings.mode.get', description: 'Tell whether the portal CRM runs in classic mode (1, with leads) or simple mode (2)' },
	{ value: 'multifieldFields', name: 'Get Contact Detail Fields', method: 'crm.multifield.fields', description: 'Describe the structure of phones, e-mails and messengers', fieldMap: true },
	{ value: 'userFieldTypes', name: 'Get Custom Field Types', method: 'crm.userfield.types', description: 'List the types a CRM custom field can have' },
	{ value: 'userFieldFields', name: 'Get Custom Field Description', method: 'crm.userfield.fields', description: 'Describe the properties a custom field definition has', fieldMap: true },
	{ value: 'userFieldEnumFields', name: 'Get List Value Fields', method: 'crm.userfield.enumeration.fields', description: 'Describe the properties of a value of a list-type custom field', fieldMap: true },
	{ value: 'requisiteCountries', name: 'Get Requisite Countries', method: 'crm.requisite.preset.countries', description: 'List the countries requisite templates can be made for' },
];

export const dictionaryResource: Resource = {
	value: 'dictionary',
	name: 'Dictionary',
	description: 'Fixed CRM enumerations: entity types, address types, CRM mode, field type lists',
	operations: [
		...DICTIONARIES.map(
			(d): Operation => ({
				value: d.value,
				name: d.name,
				action: d.name.replace(/^Get /, 'Get the ').toLowerCase().replace(/^get/, 'Get'),
				description: d.description,
				async execute(itemIndex) {
					const body = await bitrix24Request.call(this, d.method, {}, { itemIndex });
					return d.fieldMap === true ? keyedRows(body.result, 'name') : rows(body.result);
				},
			}),
		),
		{
			value: 'userFieldSettings',
			name: 'Get Custom Field Settings',
			action: 'Get the settings of a custom field type',
			description: 'Describe the settings a custom field of one type takes, e.g. precision for double',
			properties: [stringProperty('Field Type', 'fieldType', 'Custom field type, e.g. string, double, enumeration', true, 'double')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.userfield.settings.fields', { type: String(this.getNodeParameter('fieldType', itemIndex)).trim() }, { itemIndex });
				return keyedRows(body.result, 'name');
			},
		},
	],
};
