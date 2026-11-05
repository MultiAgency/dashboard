import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const contract: {
    listBuilders: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        search: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            nearAccount: z.ZodString;
            userId: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            bio: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            location: z.ZodNullable<z.ZodString>;
            links: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>;
            githubLogin: z.ZodNullable<z.ZodString>;
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
    getBuilder: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccount: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            id: z.ZodString;
            nearAccount: z.ZodString;
            userId: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            bio: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            location: z.ZodNullable<z.ZodString>;
            links: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>;
            githubLogin: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
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
    getMyBuilderProfile: import("@orpc/contract").ProcedureContract<z.ZodObject<{}, z.core.$strip>, z.ZodObject<{
        data: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            nearAccount: z.ZodString;
            userId: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            bio: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            location: z.ZodNullable<z.ZodString>;
            links: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>;
            githubLogin: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
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
    }>;
    createBuilder: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccount: z.ZodString;
        userId: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        bio: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        location: z.ZodOptional<z.ZodString>;
        links: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            id: z.ZodString;
            nearAccount: z.ZodString;
            userId: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            bio: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            location: z.ZodNullable<z.ZodString>;
            links: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>;
            githubLogin: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>;
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
    updateBuilderProfile: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccount: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        bio: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        location: z.ZodOptional<z.ZodString>;
        links: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            id: z.ZodString;
            nearAccount: z.ZodString;
            userId: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            bio: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            location: z.ZodNullable<z.ZodString>;
            links: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>;
            githubLogin: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strip>;
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
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    deleteBuilder: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        nearAccount: z.ZodString;
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
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>;
    listMembers: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        network: z.ZodOptional<z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>>;
        status: z.ZodOptional<z.ZodEnum<{
            admitted: "admitted";
            removed: "removed";
            suspended: "suspended";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            githubLogin: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                human: "human";
            }>;
            operatorGithubLogin: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            nearAccount: z.ZodNullable<z.ZodString>;
            accounts: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                account: z.ZodString;
            }, z.core.$strip>>;
            admissions: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                status: z.ZodEnum<{
                    admitted: "admitted";
                    removed: "removed";
                    suspended: "suspended";
                }>;
                proofUrl: z.ZodNullable<z.ZodString>;
                admittedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, object>;
    getMember: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        githubLogin: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            githubLogin: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                human: "human";
            }>;
            operatorGithubLogin: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            nearAccount: z.ZodNullable<z.ZodString>;
            accounts: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                account: z.ZodString;
            }, z.core.$strip>>;
            admissions: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                status: z.ZodEnum<{
                    admitted: "admitted";
                    removed: "removed";
                    suspended: "suspended";
                }>;
                proofUrl: z.ZodNullable<z.ZodString>;
                admittedAt: z.ZodNullable<z.ZodISODateTime>;
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
    putMember: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        githubLogin: z.ZodString;
        network: z.ZodEnum<{
            mainnet: "mainnet";
            testnet: "testnet";
        }>;
        kind: z.ZodEnum<{
            agent: "agent";
            human: "human";
        }>;
        operatorGithubLogin: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        account: z.ZodOptional<z.ZodObject<{
            account: z.ZodString;
            proof: z.ZodString;
        }, z.core.$strip>>;
        admission: z.ZodOptional<z.ZodObject<{
            status: z.ZodEnum<{
                admitted: "admitted";
                removed: "removed";
                suspended: "suspended";
            }>;
            proofUrl: z.ZodOptional<z.ZodURL>;
            admittedAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            githubLogin: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                human: "human";
            }>;
            operatorGithubLogin: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            nearAccount: z.ZodNullable<z.ZodString>;
            accounts: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                account: z.ZodString;
            }, z.core.$strip>>;
            admissions: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                status: z.ZodEnum<{
                    admitted: "admitted";
                    removed: "removed";
                    suspended: "suspended";
                }>;
                proofUrl: z.ZodNullable<z.ZodString>;
                admittedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        overwritten: z.ZodArray<z.ZodString>;
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
        CONFLICT: {
            readonly status: 409;
            readonly message: "Conflict";
        };
    }>;
    listMembersWithAgreements: import("@orpc/contract").ProcedureContract<z.ZodObject<{}, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            githubLogin: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                human: "human";
            }>;
            operatorGithubLogin: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            skills: z.ZodArray<z.ZodString>;
            nearAccount: z.ZodNullable<z.ZodString>;
            accounts: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                account: z.ZodString;
            }, z.core.$strip>>;
            admissions: z.ZodArray<z.ZodObject<{
                network: z.ZodEnum<{
                    mainnet: "mainnet";
                    testnet: "testnet";
                }>;
                status: z.ZodEnum<{
                    admitted: "admitted";
                    removed: "removed";
                    suspended: "suspended";
                }>;
                proofUrl: z.ZodNullable<z.ZodString>;
                admittedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            agreement: z.ZodNullable<z.ZodObject<{
                version: z.ZodString;
                attestedAt: z.ZodISODateTime;
                recordedBy: z.ZodString;
                recordedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
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
    }>;
    recordAgreement: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        githubLogin: z.ZodString;
        version: z.ZodString;
        attestedAt: z.ZodISODateTime;
        proof: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            githubLogin: z.ZodString;
            version: z.ZodString;
            attestedAt: z.ZodISODateTime;
            recordedBy: z.ZodString;
            recordedAt: z.ZodISODateTime;
        }, z.core.$strip>;
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
