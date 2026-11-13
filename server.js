require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors({
            origin: '*' 
            }));
}2)
app.use(express.json());

// Initialize Gemini
const genAI = ney GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/generate', async (req, res) => {
    try {
            const { prompt } = req.body;
                    
                            // Use the standard Gemini Pro model
                                    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                                            
                                                    const result = await model.generateContent(prompt);
                                                            const response = await result.response;
                                                                    const text = response.text();
                                                                            
                                                                                    res.json({ result: text });
                                                                                        } catch (error) {
                                                                                                console.error(error);
                                                                                                        res.status(500).json({ error: "Failed to generate text" });
                                                                                                            }
                                                                                                            });

                                                                                                            const PORT = 3000;
                                                                                                            app.listen(PORT, () => {
                                                                                                                console.log(`Server is running on port ${PORT}`);
                                                                                                                });w