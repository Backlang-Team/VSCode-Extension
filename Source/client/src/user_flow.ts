/**
 * User interaction flows factored out from core logic.
 * Most logic in here should only be querying settings, showing prompts and calling out to other APIs.
 */

import * as fs from "fs/promises";
import { ConfigurationTarget, TextEditor, Uri, window, workspace } from "vscode";
import { DebugAdapterCommandName, checkForDotnetToolUpdates, installDotnetTool, isDotnetCommandAvailable, isDotnetToolAvailable, updateDotnetTool } from "./tools";
import { PromptKind, PromptResult, prompt } from "./prompt";
import { AssetGenerator } from "./assets";
import { updateWithDefaultSettings } from "./settings";

/**
 * Prompts the user if they would like to use the stable or prerelease feed, in case they haven't chosen yet.
 */
export async function promptUserToUsePrereleaseOrStableFeed() {
    const config = workspace.getConfiguration('back');
    const sdkVersion = config.get<string>('sdkVersion') || null;
    if (sdkVersion) {
        // Already set
        return;
    }

    // Ask the user which feed they would like to use
    const response = await promptYesNoDisable(PromptKind.info, "Would you like to use the prerelease feed of the Sdk?");
    if (response === PromptResult.yes) {
        await config.update('sdkVersion', '*-*', ConfigurationTarget.Global);
    } else {
        await config.update('sdkVersion', '*', ConfigurationTarget.Global);
    }
}

/**
 * Asks the user, if they want to generate assets for the project. If they answer yes, 'tasks.json' and
 * 'launch.json' are automatically generated.
 */
export async function promptUserToCreateLaunchAndTasksConfig() {
    if (!workspace.workspaceFolders || workspace.workspaceFolders.length == 0) {
        return;
    }

    // TODO: We assume a singular workspace folder, quite inflexible
    const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

    const assets = new AssetGenerator(workspaceFolder);
    if (await assets.vscodeFolderExists()) {
        // .vscode exists, assume the user already configured it
        return;
    }

    const projectFiles = await assets.getScprojFilePaths();
    if (projectFiles.length === 0) {
        return;
    }

    const shouldGenerate = await promptYesNoDisable(
      PromptKind.info,
      "This workspace is missing files to build and debug Socordia programs. Would you like to generate them now?",
      "promptGenerateSettings"
    );
    if (shouldGenerate !== PromptResult.yes) {
        return;
    }

    // We need to generate them
    await assets.ensureVscodeFolderExists();

    const tasksDescription = {
        version: '2.0.0',
        tasks: projectFiles.map(assets.getBuildTaskDescriptionForProject),
    };
    const launchDescription = {
        version: '2.0.0',
        configurations: projectFiles.map(assets.getLaunchDescriptionForProject),
    };

    await fs.writeFile(assets.tasksJsonPath, JSON.stringify(tasksDescription, null, 4));
    await fs.writeFile(assets.launchJsonPath, JSON.stringify(launchDescription, null, 4));
}

/**
 * Checks for the availability of the dotnet command. If not available, the user is prompted if they want to
 * open their settings.
 * @returns @constant true, if the dotnet command is available, @constant false otherwise.
 */
export async function interactivelyCheckForDotnet(): Promise<boolean> {
    const checkResult = await isDotnetCommandAvailable();
    if (checkResult.isErr) {
        const errMessage = checkResult.unwrapErr().message;
        const shouldOpenSettings = await promptYesNoDisable(
            PromptKind.error,
            `The dotnet command failed. Open settings?\n${errMessage}`,
            'promptOpenSettings');
        if (shouldOpenSettings !== PromptResult.yes) {
            return false;
        }

        if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
            // TODO: We assume a singular workspace folder, quite inflexible
            const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

            const assets = new AssetGenerator(workspaceFolder);

            await updateWithDefaultSettings(ConfigurationTarget.Workspace);
            await openDocument(Uri.file(assets.settingsJsonPath));
        }

        return false;
    }
    // We have dotnet available
    return true;
}

/**
 * Checks, if the given tool is installed. If not installed, the user is prompted if they want to install
 * it. If installed, it checks for updates. If there are updates available, the user is prompted if they want to
 * update.
 * @param config The tool configuration.
 * @returns @constant true, if the tool is available in some form, even if updating failed for example.
 * @constant false, if the tool is not available in any form.
 */
async function interactivelyInitializeDotnetTool(config: {
    toolName: string;
    toolCommand: string;
    toolDisplayName: string;
    installSetting: string;
    updateSetting: string;
}): Promise<boolean> {
    // Check, if the tool is installed
    const isInstalledResult = await isDotnetToolAvailable(config.toolName);
    if (isInstalledResult.isErr) {
        const errMessage = isInstalledResult.unwrapErr().message;
        await window.showErrorMessage(`Failed to check for ${config.toolDisplayName}.\n${errMessage}`);
        return false;
    }

    const isInstalled = isInstalledResult.unwrap();
    if (!isInstalled) {
        // Not installed yet, ask the user
        const shouldInstall = await promptYesNoDisable(
            PromptKind.info,
            `${config.toolDisplayName} is not installed. Would you like to install it?`,
            config.installSetting);
        if (shouldInstall !== PromptResult.yes) {
            // Should not install, tool isn't installed
            return false;
        }

        // Try to install it
        const installResult = await installDotnetTool(config.toolName);
        if (installResult.isErr) {
            const errMessage = installResult.unwrapErr().message;
            await window.showErrorMessage(`Failed to install ${config.toolDisplayName}.\n${errMessage}`);
            return false;
        }
        // We installed successfully
        await window.showInformationMessage(`${config.toolDisplayName} installed successfully.`);
        return true;
    }

    // Tool is already installed, check for updates
    const checkForUpdateResult = await checkForDotnetToolUpdates(config.toolCommand);
    if (checkForUpdateResult.isErr) {
        const errMessage = checkForUpdateResult.unwrapErr().message;
        await window.showErrorMessage(`Could not check for updates for ${config.toolDisplayName}.\n${errMessage}`);
        // We could not check for updates, but we do have a local install, we can use that
        return true;
    }

    const areThereUpdates = checkForUpdateResult.unwrap();
    if (!areThereUpdates) {
        return true;
    }

    // There are updates, ask
    const doUpdateResponse = await promptYesNoDisable(
        PromptKind.info,
        `There are updates available for ${config.toolDisplayName}. Would you like to update?`,
        config.updateSetting);
    if (doUpdateResponse !== PromptResult.yes) {
        // We don't want to update
        return true;
    }

    // We want to update
    const updateResult = await updateDotnetTool(config.toolName);
    if (updateResult.isErr) {
        const errMessage = updateResult.unwrapErr().message;
        await window.showErrorMessage(`Could not updates ${config.toolDisplayName}.\n${errMessage}`);
        // We could not update, but we do have a local install, we can use that
        return true;
    }

    // We updated successfully
    await window.showInformationMessage(`${config.toolDisplayName} updated successfully.`);
    return true;
}

/**
 * Prompts the user with 3 options, Yes, No and Disable.
 * If the user picks Disable, the setting will be flipped and the prompt won't appear again.
 * The disable option is only available, if a setting name is provided
 * @param kind The @see PromptKind to display.
 * @param message The message to display.
 * @param setting The setting to save the prompt result to.
 * @returns The promise to the @see PromptResult.
 */
async function promptYesNoDisable(kind: PromptKind, message: string, setting?: string): Promise<PromptResult> {
    const config = workspace.getConfiguration('back');

    // If we don't allow prompting, don't bother
    if (setting && !config.get<boolean>(setting)) {
        return PromptResult.disable;
    }

    // Assemble items
    const promptItems = [
        { title: 'Yes', result: PromptResult.yes },
        { title: 'No', result: PromptResult.no },
    ];
    if (setting) {
        promptItems.push({ title: "Don't Ask Again", result: PromptResult.disable });
    }

    // Actually ask the user
    const result = await prompt(kind, message, ...promptItems);

    // In case the user wants to disable it, save that option
    if (setting && result === PromptResult.disable) {
        await config.update(setting, false, ConfigurationTarget.Workspace);
    }

    return result;
}

/**
 * Opens a document in the editor.
 * @param uri The @see Uri of the document to open.
 * @returns The promise of the opened editor.
 */
async function openDocument(uri: Uri): Promise<TextEditor> {
    const textDocument = await workspace.openTextDocument(uri);
    return window.showTextDocument(textDocument);
}
