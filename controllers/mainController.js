export const mainController = {
    // Health check
    healthCheck: (req, res) => {
        res.status(200).json({
            status: 'ok',
            message: 'Server is running',
            timestamp: new Date().toISOString(),
            port: process.env.PORT
        });
    },
    
    // Crypto information
    cryptoInfo: (req, res, services) => {
        res.json({
            nodeVersion: process.version,
            opensslVersion: process.versions.openssl,
            algorithm: services.algorithm,
            keyLength: services.key.length,
            ivLength: services.iv.length,
            environment: {
                algorithm: process.env.ENCRYPTION_ALGORITHM,
                keyPresent: Boolean(process.env.ENCRYPTION_KEY),
                ivPresent: Boolean(process.env.ENCRYPTION_IV)
            }
        });
    },
    
    // Test decryption
    testDecrypt: async (req, res, services) => {
        try {
            const { encryptedText } = req.body;
            if (!encryptedText) {
                return res.status(400).json({ error: "Missing encryptedText in request body" });
            }

            const decrypted = services.decrypt(encryptedText);
            res.json({
                input: encryptedText,
                decrypted: decrypted,
                config: {
                    algorithm: services.algorithm,
                    keyLength: services.key.length,
                    ivLength: services.iv.length
                }
            });
        } catch (error) {
            res.status(500).json({
                error: 'Decryption failed',
                message: error.message
            });
        }
    }
};
