import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const contract: {
    listProjects: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        organizationId: z.ZodOptional<z.ZodString>;
        ownerId: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            idea: "idea";
            project: "project";
            result: "result";
            scope: "scope";
        }>>;
        visibility: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            unlisted: "unlisted";
        }>>;
        status: z.ZodOptional<z.ZodEnum<{
            active: "active";
            archived: "archived";
            paused: "paused";
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    getProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
            apps: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                projectId: z.ZodString;
                accountId: z.ZodString;
                domain: z.ZodString;
                createdByUserId: z.ZodString;
                createdAt: z.ZodISODateTime;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    getProjectBySlug: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        slug: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
            apps: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                projectId: z.ZodString;
                accountId: z.ZodString;
                domain: z.ZodString;
                createdByUserId: z.ZodString;
                createdAt: z.ZodISODateTime;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    createProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        kind: z.ZodEnum<{
            idea: "idea";
            project: "project";
            result: "result";
            scope: "scope";
        }>;
        title: z.ZodString;
        slug: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        visibility: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            unlisted: "unlisted";
        }>>;
        repository: z.ZodOptional<z.ZodString>;
        organizationId: z.ZodOptional<z.ZodString>;
        ownerId: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        organizationId: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            idea: "idea";
            project: "project";
            result: "result";
            scope: "scope";
        }>;
        slug: z.ZodString;
        title: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        content: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            active: "active";
            archived: "archived";
            paused: "paused";
        }>;
        visibility: z.ZodEnum<{
            private: "private";
            public: "public";
            unlisted: "unlisted";
        }>;
        repository: z.ZodNullable<z.ZodString>;
        domain: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    updateProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodOptional<z.ZodEnum<{
            idea: "idea";
            project: "project";
            result: "result";
            scope: "scope";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<{
            active: "active";
            archived: "archived";
            paused: "paused";
        }>>;
        visibility: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            unlisted: "unlisted";
        }>>;
        repository: z.ZodOptional<z.ZodString>;
        ownerId: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        organizationId: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            idea: "idea";
            project: "project";
            result: "result";
            scope: "scope";
        }>;
        slug: z.ZodString;
        title: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        content: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            active: "active";
            archived: "archived";
            paused: "paused";
        }>;
        visibility: z.ZodEnum<{
            private: "private";
            public: "public";
            unlisted: "unlisted";
        }>;
        repository: z.ZodNullable<z.ZodString>;
        domain: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    deleteProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        deleted: z.ZodBoolean;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    listProjectApps: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        projectId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            projectId: z.ZodString;
            accountId: z.ZodString;
            domain: z.ZodString;
            createdByUserId: z.ZodString;
            createdAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    linkAppToProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        projectId: z.ZodString;
        accountId: z.ZodString;
        domain: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").InitialOutputSchema, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    unlinkAppFromProject: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        projectId: z.ZodString;
        accountId: z.ZodString;
        domain: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        deleted: z.ZodBoolean;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    listProjectsForApp: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        accountId: z.ZodString;
        domain: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>;
    listMentions: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    listMentionedBy: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            ownerId: z.ZodString;
            organizationId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                idea: "idea";
                project: "project";
                result: "result";
                scope: "scope";
            }>;
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            content: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                active: "active";
                archived: "archived";
                paused: "paused";
            }>;
            visibility: z.ZodEnum<{
                private: "private";
                public: "public";
                unlisted: "unlisted";
            }>;
            repository: z.ZodNullable<z.ZodString>;
            domain: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
};
export type ContractType = typeof contract;
