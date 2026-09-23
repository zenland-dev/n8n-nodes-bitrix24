import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact } from '../../../shared/params';
import { positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt } from '../../../shared/values';

export const consentResource: Resource = {
	value: 'consent',
	name: 'Consent',
	description: 'Consents given to an agreement: who agreed, to what, from where',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a consent',
			description:
				'Record that a person agreed to an agreement. Bitrix24 stores what it is given; showing the text and collecting the answer happens on your side.',
			properties: [
				{
					displayName: 'Agreement ID',
					name: 'agreementId',
					type: 'number',
					required: true,
					default: 0,
					description: 'ID of the agreement that was accepted, as Agreement → Get Many returns it',
				},
				{
					displayName: 'IP Address',
					name: 'ip',
					type: 'string',
					required: true,
					default: '',
					placeholder: '203.0.113.7',
					description: 'Address the consent came from. Bitrix24 requires it and stores it as given.',
				},
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{
							displayName: 'Origin ID',
							name: 'ORIGIN_ID',
							type: 'string',
							default: '',
							placeholder: 'my_contact_form',
							description: 'Where the consent was collected, in your own wording',
						},
						{
							displayName: 'Originator ID',
							name: 'ORIGINATOR_ID',
							type: 'string',
							default: '',
							description: 'Which element of that source it was, for example the e-mail that was entered',
						},
						{
							displayName: 'Page URL',
							name: 'URL',
							type: 'string',
							default: '',
							placeholder: 'https://example.com/signup',
							description: 'Address of the page the consent was given on',
						},
						{
							displayName: 'User ID',
							name: 'USER_ID',
							type: 'number',
							default: 0,
							description: 'Portal user the consent belongs to, when it is an employee and not a visitor',
						},
					],
				},
			],
			async execute(itemIndex) {
				const ip = String(this.getNodeParameter('ip', itemIndex, '')).trim();
				if (ip === '') {
					throw new NodeOperationError(this.getNode(), 'IP Address is required', {
						itemIndex,
						description: 'Bitrix24 refuses a consent without the address it came from.',
					});
				}

				const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
				const params: IDataObject = compact({
					AGREEMENT_ID: positiveInt(this, 'agreementId', itemIndex, 'Agreement ID'),
					IP: ip,
					URL: extra.URL,
					ORIGIN_ID: extra.ORIGIN_ID,
					ORIGINATOR_ID: extra.ORIGINATOR_ID,
					USER_ID: optionalInt(extra.USER_ID),
				});

				const body = await bitrix24Request.call(this, 'userconsent.consent.add', params, { itemIndex });
				return { id: body.result as number };
			},
		},
	],
};
