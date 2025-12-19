export class DomainError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.name = "DomainError";
        this.code = code;
    }
}
