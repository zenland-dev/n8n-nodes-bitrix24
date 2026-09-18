import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { jsonParameter } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';

const eventTokenProperty: INodeProperties = {
	displayName: 'Event Token',
	name: 'eventToken',
	type: 'string',
	// It names one paused process and lets anyone holding it answer for that process,
	// so n8n hides it the way it hides a password.
	typeOptions: { password: true },
	required: true,
	default: '',
	description:
		'The token the waiting automation rule or action sent along with its data. It names one paused process, so it comes from the workflow input, not typed in by hand.',
};

function token(ctx: IExecuteFunctions, itemIndex: number): string {
	const value = String(ctx.getNodeParameter('eventToken', itemIndex, '')).trim();
	if (value === '') {
		throw new NodeOperationError(ctx.getNode(), 'Event Token is required', {
			itemIndex,
			description: 'Take it from the data the automation rule posted to this workflow.',
		});
	}
	return value;
}

export const eventResource: Resource = {
	value: 'event',
	name: 'Event',
	description: 'Answers back to a business process that is waiting for an automation rule or an action',
	operations: [
		{
			value: 'sendResult',
			name: 'Send Result',
			action: 'Send a result to a waiting business process',
			description:
				'Return values to the automation rule or action that is waiting, which lets the process move on to its next step',
			properties: [
				eventTokenProperty,
				{
					displayName: 'Return Values (JSON)',
					name: 'returnValuesJson',
					type: 'json',
					default: '{}',
					description:
						'Values for the fields the rule registered as its results, by code, e.g. {"score": 42}. What the rule did not register is dropped by Bitrix24.',
				},
				{
					displayName: 'Log Message',
					name: 'logMessage',
					type: 'string',
					typeOptions: { rows: 2 },
					default: '',
					description: 'Line for the process log. It appears only when the template has logging switched on.',
				},
			],
			async execute(itemIndex) {
				const eventToken = token(this, itemIndex);
				const returnValues = jsonParameter<IDataObject>(this, 'returnValuesJson', itemIndex, {});
				const logMessage = String(this.getNodeParameter('logMessage', itemIndex, '')).trim();

				const params: IDataObject = { EVENT_TOKEN: eventToken };
				if (Object.keys(returnValues).length > 0) params.RETURN_VALUES = returnValues;
				if (logMessage !== '') params.LOG_MESSAGE = logMessage;

				const body = await bitrix24Request.call(this, 'bizproc.event.send', params, { itemIndex });
				return { sent: body.result === true };
			},
		},
		{
			value: 'writeLog',
			name: 'Write Log',
			action: 'Write a line into the business process log',
			description:
				'Put a line into the log of the waiting process without answering it, e.g. to report progress of a long job',
			properties: [
				eventTokenProperty,
				{
					displayName: 'Log Message',
					name: 'logMessage',
					type: 'string',
					required: true,
					typeOptions: { rows: 2 },
					default: '',
					description: 'What to write. It appears only when the template has logging switched on.',
				},
			],
			async execute(itemIndex) {
				const eventToken = token(this, itemIndex);
				const logMessage = String(this.getNodeParameter('logMessage', itemIndex, '')).trim();
				if (logMessage === '') {
					throw new NodeOperationError(this.getNode(), 'Log Message is required', { itemIndex });
				}

				const body = await bitrix24Request.call(
					this,
					'bizproc.activity.log',
					{ EVENT_TOKEN: eventToken, LOG_MESSAGE: logMessage },
					{ itemIndex },
				);
				return { logged: body.result === true };
			},
		},
	],
};
