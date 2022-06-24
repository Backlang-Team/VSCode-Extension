﻿using MediatR;
using OmniSharp.Extensions.LanguageServer.Protocol;
using OmniSharp.Extensions.LanguageServer.Protocol.Client.Capabilities;
using OmniSharp.Extensions.LanguageServer.Protocol.Document;
using OmniSharp.Extensions.LanguageServer.Protocol.Models;
using OmniSharp.Extensions.LanguageServer.Protocol.Server.Capabilities;

internal class TextDocumentSyncHandler : ITextDocumentSyncHandler
{
    private readonly BufferManager _bufferManager;

    private readonly DocumentSelector _documentSelector = new DocumentSelector(
        new DocumentFilter()
        {
            Pattern = "**/*.back"
        }
    );

    private SynchronizationCapability _capability;

    public TextDocumentSyncHandler(BufferManager bufferManager)
    {
        _bufferManager = bufferManager;
    }

    public TextDocumentSyncKind Change { get; } = TextDocumentSyncKind.Full;

    public TextDocumentChangeRegistrationOptions GetRegistrationOptions(SynchronizationCapability capability, ClientCapabilities clientCapabilities)
    {
        return new TextDocumentChangeRegistrationOptions()
        {
            DocumentSelector = _documentSelector,
            SyncKind = Change
        };
    }

    TextDocumentOpenRegistrationOptions IRegistration<TextDocumentOpenRegistrationOptions, SynchronizationCapability>.GetRegistrationOptions(SynchronizationCapability capability, ClientCapabilities clientCapabilities)
    {
        return null;
    }

    TextDocumentCloseRegistrationOptions IRegistration<TextDocumentCloseRegistrationOptions, SynchronizationCapability>.GetRegistrationOptions(SynchronizationCapability capability, ClientCapabilities clientCapabilities)
    {
        return null;
    }

    TextDocumentSaveRegistrationOptions IRegistration<TextDocumentSaveRegistrationOptions, SynchronizationCapability>.GetRegistrationOptions(SynchronizationCapability capability, ClientCapabilities clientCapabilities)
    {
        return null;
    }

    public TextDocumentAttributes GetTextDocumentAttributes(DocumentUri uri)
    {
        return new TextDocumentAttributes(uri, "back");
    }

    public Task<Unit> Handle(DidChangeTextDocumentParams request, CancellationToken cancellationToken)
    {
        var documentPath = request.TextDocument.Uri.ToString();
        var text = request.ContentChanges.FirstOrDefault()?.Text;

        _bufferManager.UpdateBuffer(documentPath, text);

        return Unit.Task;
    }

    public Task<Unit> Handle(DidOpenTextDocumentParams request, CancellationToken cancellationToken)
    {
        _bufferManager.UpdateBuffer(request.TextDocument.Uri.ToString(), request.TextDocument.Text);
        return Unit.Task;
    }

    public Task<Unit> Handle(DidCloseTextDocumentParams request, CancellationToken cancellationToken)
    {
        return Unit.Task;
    }

    public Task<Unit> Handle(DidSaveTextDocumentParams request, CancellationToken cancellationToken)
    {
        return Unit.Task;
    }
}