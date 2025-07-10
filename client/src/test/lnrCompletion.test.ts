/* Tests for Lunor language completion in the client extension */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { getDocUri, activate } from './helper';

suite('Lunor Completion', () => {
  const docUri = getDocUri('simple.lnr');

  test('provides core Lunor directives', async () => {
    await activate(docUri);
    const position = new vscode.Position(1, 1); // cursor after ':' on second line
    const completions = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      docUri,
      position
    )) as vscode.CompletionList;

    // should include state, data, for, if snippets
    const labels = completions.items.map(item => item.label.toString());
    assert.ok(labels.includes(':state'), 'missing :state');
    assert.ok(labels.includes(':data'), 'missing :data');
    assert.ok(labels.includes(':for'), 'missing :for');
    assert.ok(labels.includes(':if'), 'missing :if');
  });
});
