
#include "parser2.h"

namespace ts {
    SyntaxKind Parser::token() {
        return currentToken;
    }

    SyntaxKind Parser::nextTokenWithoutCheck() {
        return currentToken = scanner.scan();
    }

    optional<DiagnosticWithDetachedLocation> Parser::parseErrorAtPosition(int start, int length, const DiagnosticMessage &message, DiagnosticArg arg) {
        // Mark that we've encountered an error.  We'll set an appropriate bit on the next
        // node we finish so that it can't be reused incrementally.
        parseErrorBeforeNextFinishedNode = true;

        // Don't report another error if it would just be at the same position as the last error.
        if (!parseDiagnostics.empty() || start != parseDiagnostics.back().start) {
            auto d = createDetachedDiagnostic(fileName, start, length, message, {arg});
            parseDiagnostics.push_back(d);
            return d;
        }
        return nullopt;
    }

    shared<Node> Parser::countNode(const shared<Node> &node) {
        nodeCount++;
        return node;
    }
}