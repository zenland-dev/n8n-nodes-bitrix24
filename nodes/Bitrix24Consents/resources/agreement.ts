import type { IDataObject } from 'n8n-workflow';

import { compact, jsonParameter } from '../../../shared/params';
import { positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';

export const agreementResource: Resource = {
	value: 'agreement',
	name: 'Agreement',
	description: 'The agreements a portal keeps: their names, languages and text',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many agreements',
			description: 'Read every agreement of the portal with its ID, name, language and whether it is switched on',
			properties: [],
			async execute(itemIndex) {
				// The method takes no parameters and answers every agreement at once.
				const body = await bitrix24Request.call(this, 'userconsent.agreement.list', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getText',
			name: 'Get Text',
			action: 'Get the text of an agreement',
			description:
				'Read the wording a person is asked to agree to, with the company details filled into a standard agreement',
			properties: [
				{
					displayName: 'Agreement ID',
					name: 'agreementId',
					type: 'number',
					required: true,
					default: 0,
					description: 'ID of the agreement, as Agreement → Get Many returns it',
				},
				{
					displayName: 'Substitutions',
					name: 'replace',
					type: 'collection',
					placeholder: 'Add Substitution',
					default: {},
					description:
						'Values put into a standard agreement made from a Bitrix24 template. An agreement written by hand keeps its own text and ignores them.',
					options: [
						{
							displayName: 'Button Caption',
							name: 'buttonCaption',
							type: 'string',
							default: '',
							placeholder: 'I agree',
							description: 'Wording of the confirmation button, returned in LABEL',
						},
						{
							displayName: 'Company Address',
							name: 'COMPANY_ADDRESS',
							type: 'string',
							default: '',
							description: 'Address of the company that processes the data',
						},
						{
							displayName: 'Company Name',
							name: 'COMPANY_NAME',
							type: 'string',
							default: '',
							description: 'Name of the company that processes the data',
						},
						{
							displayName: 'Email',
							name: 'EMAIL',
							type: 'string',
							default: '',
							placeholder: 'privacy@example.com',
							description: 'Address a person writes to about their data',
						},
						{
							displayName: 'Purposes',
							name: 'PURPOSES',
							type: 'string',
							default: '',
							description: 'What the data is processed for',
						},
						{
							displayName: 'Third Parties',
							name: 'THIRD_PARTIES',
							type: 'string',
							default: '',
							description: 'Who else the data is passed to',
						},
					],
				},
				{
					displayName: 'Extra Substitutions (JSON)',
					name: 'replaceJson',
					type: 'json',
					default: '{}',
					description:
						'Fields merged into the ones above, for a template with placeholders of its own, e.g. {"fields": {"COMPANY_NAME": "Acme"}}',
				},
			],
			async execute(itemIndex) {
				const collection = this.getNodeParameter('replace', itemIndex, {}) as IDataObject;
				const fields = compact({
					COMPANY_NAME: collection.COMPANY_NAME,
					COMPANY_ADDRESS: collection.COMPANY_ADDRESS,
					PURPOSES: collection.PURPOSES,
					THIRD_PARTIES: collection.THIRD_PARTIES,
					EMAIL: collection.EMAIL,
				});

				const replace: IDataObject = { ...jsonParameter<IDataObject>(this, 'replaceJson', itemIndex, {}) };
				const buttonCaption = String(collection.buttonCaption ?? '').trim();
				if (buttonCaption !== '') replace.button_caption = buttonCaption;
				if (Object.keys(fields).length > 0) {
					replace.fields = { ...((replace.fields as IDataObject) ?? {}), ...fields };
				}

				const params: IDataObject = { id: positiveInt(this, 'agreementId', itemIndex, 'Agreement ID') };
				if (Object.keys(replace).length > 0) params.replace = replace;

				const body = await bitrix24Request.call(this, 'userconsent.agreement.text', params, { itemIndex });
				return rows(body.result);
			},
		},
	],
};
