const express = require('express');
const cors = require('cors');
const { publicDir } = require('./src/paths');
const apiRoutes = require('./src/routes');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.use('/api', apiRoutes);

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`[iOS-Enroller] Serveur démarré sur http://localhost:${PORT}`);
});
