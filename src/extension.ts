import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// utility functie die aangenamer werkt dan setTimeout
async function wait(delay: number): Promise<void> {
    await new Promise((resolve, _reject) => {
        setTimeout(resolve, delay);
    });
}

// callback voor wanneer de extensie wordt geactiveerd, dus als je ze aanzet
export function activate(context: vscode.ExtensionContext) {

    // we houden bij wat je plakt
    let pasteOps: { text: string, timestampInMillis: number }[] = [];

    // wanneer je iets plakt, zetten we dat in bovenstaande lijst
    const triggeredAction = vscode.workspace.onDidChangeTextDocument(event => {
        const changes = event.contentChanges;
        changes.forEach(change => {
            const isPasteOperation = change.text.length > 25;
            if (isPasteOperation) {
                const timestampInMillis: number = Date.now();
                pasteOps.push({ text: change.text, timestampInMillis });
            }
        });
    });

    // je moet de extensie expliciet aanzetten met een commando
    const timedAction = vscode.commands.registerCommand('fairexam.monitor', async () => {
        let userID = null;
        while (!userID) {
            userID = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                prompt: "Vul hier je voor het examen meegedeelde UID in."
            });
        }
        let serverAddress = null;
        while (!serverAddress) {
            serverAddress = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                prompt: "Vul hier het voor het examen meegedeelde serveradres in."
            });
        }
        // we lezen de code van de ingeladen extensie om te garanderen dat ze niet aangepast is
        const extensionPath = context.extensionPath;
        const compiledPath = path.join(extensionPath, 'out', 'extension.js');
        let madeContact = false;
        try {
            const fileContent = await fs.readFile(compiledPath, 'utf8');
            // als je op "Cancel" hebt geduwd, gaan we niet voort
            // dan zal je de extensie dus opnieuw moeten activeren
            if (userID && serverAddress) {
                // we registreren de callback voor paste operaties (anders doet deze niets)
                context.subscriptions.push(triggeredAction);
                // door een hash van broncode en je UID te sturen, weten we dat je de code niet hebt aangepast
                const hash = crypto.createHash('sha256').update(fileContent + userID).digest('hex');
                /* loop om regelmatig info door te sturen
                 * we sturen:
                 * - je user ID
                 * - timestamp
                 * - de lijst met je actieve extensions
                 * - inhoud open bestanden
                 * - recente copy-paste operaties
                 * - een hash om na te gaan dat de code niet gewijzigd is */
                while (true) {
                    try {
                        const timestampInMillis: number = Date.now();
                        const activeExtensions = vscode.extensions.all
                            .filter(extension => extension.isActive)
                            .map(extension => ({
                                id: extension.id,
                                name: extension.packageJSON.displayName || extension.packageJSON.name,
                                version: extension.packageJSON.version
                            }));
                        const openDocuments = vscode.workspace.textDocuments;
                        if (openDocuments.length > 15) {
                            vscode.window.showInformationMessage("Er staan te veel documenten open. Beperk tot maximum 15.");
                        }
                        else {
                            const buffers = openDocuments.map(doc => ({
                                uri: doc.uri.toString(),
                                fileName: doc.fileName,
                                isDirty: doc.isDirty,
                                content: doc.getText().slice(0, 500 * 99)
                            }));
                            const bufferedPasteOps = [...pasteOps];
                            const jsonData = JSON.stringify({
                                userID,
                                timestampInMillis,
                                activeExtensions,
                                buffers,
                                bufferedPasteOps,
                                hash
                            });
                            const init = { method: 'POST', headers: { "Content-Type": "application/json" }, body: jsonData };
                            const response = await fetch(serverAddress, init);
                            // TODO: also make sure server verifies user ID
                            if (response.ok) {
                                if (!madeContact) {
                                    vscode.window.showInformationMessage("Contact kunnen maken.");
                                    madeContact = true;
                                }
                                pasteOps = [];
                            }
                            else if (response.status == 404) {
                                vscode.window.showInformationMessage("Serveradres niet gevonden.");
                            }
                            else if (!madeContact) {
                                vscode.window.showInformationMessage("Nog geen contact kunnen maken.");
                            }
                        }
                    }
                    catch (err) {
                        console.debug(err);
                        if (!madeContact) {
                            vscode.window.showInformationMessage("Nog geen contact kunnen maken.");
                        }
                    }
                    let randomDelay = 1000 * (Math.floor(Math.random() * 120) + 1);
                    await wait(randomDelay);
                }
            }
            else {
                vscode.window.showInformationMessage("UID en/of serveradres zijn niet geldig ingevuld. De extensie wordt niet geactiveerd.");
            }
        } catch (err) {
            vscode.window.showInformationMessage("Broncode kon niet gelezen worden. De extensie wordt niet geactiveerd.");
        }
    });
    context.subscriptions.push(timedAction);
}

// extensie deactiveren doe je gewoon door VSC af te sluiten
export function deactivate() { }
