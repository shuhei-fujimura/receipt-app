// ===== Receipt Manager App =====

class ReceiptManager {
    constructor() {
        this.expenses = [];
        this.currentImageData = null;
        this.init();
    }

    init() {
        this.loadFromStorage();
        this.initTabs();
        this.initUpload();
        this.initForm();
        this.initFilters();
        this.initExport();
        this.renderList();
        this.renderSummary();
    }

    // ===== Tab Navigation =====
    initTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        // Update active tab button
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        // Update active section
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(`${tabName}-section`).classList.add('active');

        // Refresh content when switching tabs
        if (tabName === 'list') {
            this.renderList();
        } else if (tabName === 'summary') {
            this.renderSummary();
        }
    }

    // ===== Upload Handling =====
    initUpload() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const cameraInput = document.getElementById('camera-input');

        // Click on upload area
        uploadArea.addEventListener('click', (e) => {
            if (e.target.tagName === 'LABEL' || e.target.closest('label')) return;
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        cameraInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processImage(files[0]);
            }
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processImage(file);
        }
        event.target.value = ''; // Reset input
    }

    async processImage(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast('画像ファイルを選択してください', 'error');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = async (e) => {
            this.currentImageData = e.target.result;
            document.getElementById('preview-image').src = this.currentImageData;
            document.getElementById('preview-card').style.display = 'block';
            document.getElementById('ocr-status').style.display = 'flex';
            document.getElementById('form-card').style.display = 'none';

            // Run OCR
            try {
                await this.runOCR(this.currentImageData);
            } catch (error) {
                console.error('OCR Error:', error);
                this.showToast('読み取りに失敗しました。手動で入力してください。', 'error');
                this.showForm({});
            }
        };
        reader.readAsDataURL(file);
    }

    async runOCR(imageData) {
        const worker = await Tesseract.createWorker('jpn+eng');
        
        try {
            const result = await worker.recognize(imageData);
            const text = result.data.text;
            console.log('OCR Result:', text);
            
            // Extract data from OCR text
            const extractedData = this.extractDataFromText(text);
            this.showForm(extractedData);
        } finally {
            await worker.terminate();
        }
    }

    extractDataFromText(text) {
        const data = {};
        
        // Extract date patterns: YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月DD日, etc.
        const datePatterns = [
            /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/,
            /令和(\d{1,2})年(\d{1,2})月(\d{1,2})日/,
            /R(\d{1,2})\.(\d{1,2})\.(\d{1,2})/,
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/
        ];
        
        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                let year, month, day;
                if (pattern.toString().includes('令和') || pattern.toString().includes('R')) {
                    // 令和年を西暦に変換
                    year = 2018 + parseInt(match[1]);
                    month = match[2];
                    day = match[3];
                } else if (match[3] && match[3].length <= 2) {
                    // MM/DD/YY format
                    month = match[1];
                    day = match[2];
                    year = parseInt(match[3]) > 50 ? 1900 + parseInt(match[3]) : 2000 + parseInt(match[3]);
                } else {
                    year = match[1];
                    month = match[2];
                    day = match[3];
                }
                data.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                break;
            }
        }

        // Extract amount patterns: ¥1,234, 1,234円, 合計 1234, etc.
        const amountPatterns = [
            /(?:合計|計|小計|総額|お支払|支払)[^\d]*[¥￥]?\s*([0-9,]+)/,
            /[¥￥]\s*([0-9,]+)/,
            /([0-9,]+)\s*円/,
            /(?:TOTAL|Total|total)[^\d]*([0-9,]+)/
        ];
        
        for (const pattern of amountPatterns) {
            const matches = text.match(new RegExp(pattern, 'g'));
            if (matches) {
                // Get the largest amount (usually the total)
                let maxAmount = 0;
                matches.forEach(m => {
                    const numMatch = m.match(/([0-9,]+)/);
                    if (numMatch) {
                        const amount = parseInt(numMatch[1].replace(/,/g, ''));
                        if (amount > maxAmount && amount < 10000000) { // Reasonable limit
                            maxAmount = amount;
                        }
                    }
                });
                if (maxAmount > 0) {
                    data.amount = maxAmount;
                    break;
                }
            }
        }

        // Extract store name (usually at the top of receipt)
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 0) {
            // First few lines often contain store name
            for (let i = 0; i < Math.min(5, lines.length); i++) {
                const line = lines[i].trim();
                // Skip lines that are mostly numbers or very short
                if (line.length > 2 && !/^\d+$/.test(line) && !/^[0-9\-\/]+$/.test(line)) {
                    // Skip common header patterns
                    if (!line.match(/^(領収|レシート|伝票|TEL|電話|〒)/)) {
                        data.vendor = line.substring(0, 50); // Limit length
                        break;
                    }
                }
            }
        }

        // Try to auto-detect category from keywords
        const textLower = text.toLowerCase();
        if (textLower.includes('ガソリン') || textLower.includes('給油') || textLower.includes('燃料')) {
            data.category = 'ガソリン代';
        } else if (textLower.includes('駐車') || textLower.includes('パーキング')) {
            data.category = '駐車場代';
        } else if (textLower.includes('高速') || textLower.includes('etc') || textLower.includes('料金所')) {
            data.category = '高速道路代';
        } else if (textLower.includes('美容') || textLower.includes('ヘア') || textLower.includes('サロン')) {
            data.category = '消耗品費';
        }

        return data;
    }

    showForm(data) {
        document.getElementById('ocr-status').style.display = 'none';
        document.getElementById('form-card').style.display = 'block';

        // Set form values
        document.getElementById('expense-date').value = data.date || new Date().toISOString().split('T')[0];
        document.getElementById('expense-amount').value = data.amount || '';
        document.getElementById('expense-vendor').value = data.vendor || '';
        document.getElementById('expense-category').value = data.category || '';
        document.getElementById('expense-memo').value = '';
    }

    // ===== Form Handling =====
    initForm() {
        const form = document.getElementById('expense-form');
        const cancelBtn = document.getElementById('cancel-btn');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveExpense();
        });

        cancelBtn.addEventListener('click', () => {
            this.resetUploadArea();
        });
    }

    saveExpense() {
        const expense = {
            id: Date.now(),
            date: document.getElementById('expense-date').value,
            amount: parseInt(document.getElementById('expense-amount').value) || 0,
            vendor: document.getElementById('expense-vendor').value,
            category: document.getElementById('expense-category').value,
            memo: document.getElementById('expense-memo').value,
            imageData: this.currentImageData,
            createdAt: new Date().toISOString()
        };

        this.expenses.push(expense);
        this.saveToStorage();
        this.resetUploadArea();
        this.showToast('経費を登録しました！', 'success');
    }

    resetUploadArea() {
        document.getElementById('preview-card').style.display = 'none';
        document.getElementById('form-card').style.display = 'none';
        document.getElementById('expense-form').reset();
        this.currentImageData = null;
    }

    deleteExpense(id) {
        if (confirm('この経費を削除しますか？')) {
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.saveToStorage();
            this.renderList();
            this.showToast('削除しました', 'success');
        }
    }

    // ===== Storage =====
    saveToStorage() {
        // Save without image data to reduce storage size
        const dataToSave = this.expenses.map(e => ({
            ...e,
            imageData: null // Don't store images in localStorage
        }));
        localStorage.setItem('receipt_expenses', JSON.stringify(dataToSave));
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem('receipt_expenses');
            if (data) {
                this.expenses = JSON.parse(data);
            }
        } catch (error) {
            console.error('Failed to load data:', error);
            this.expenses = [];
        }
    }

    // ===== Filters =====
    initFilters() {
        const filterMonth = document.getElementById('filter-month');
        const filterCategory = document.getElementById('filter-category');

        filterMonth.addEventListener('change', () => this.renderList());
        filterCategory.addEventListener('change', () => this.renderList());
    }

    updateFilterOptions() {
        const filterMonth = document.getElementById('filter-month');
        const filterCategory = document.getElementById('filter-category');

        // Get unique months
        const months = new Set();
        this.expenses.forEach(e => {
            const date = new Date(e.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            months.add(monthKey);
        });

        // Update month filter
        const currentMonth = filterMonth.value;
        filterMonth.innerHTML = '<option value="">全期間</option>';
        Array.from(months).sort().reverse().forEach(month => {
            const [year, m] = month.split('-');
            filterMonth.innerHTML += `<option value="${month}">${year}年${parseInt(m)}月</option>`;
        });
        filterMonth.value = currentMonth;

        // Get unique categories
        const categories = new Set(this.expenses.map(e => e.category).filter(c => c));
        
        const currentCategory = filterCategory.value;
        filterCategory.innerHTML = '<option value="">全カテゴリ</option>';
        categories.forEach(cat => {
            filterCategory.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
        filterCategory.value = currentCategory;
    }

    getFilteredExpenses() {
        const filterMonth = document.getElementById('filter-month').value;
        const filterCategory = document.getElementById('filter-category').value;

        return this.expenses.filter(e => {
            if (filterMonth) {
                const date = new Date(e.date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (monthKey !== filterMonth) return false;
            }
            if (filterCategory && e.category !== filterCategory) {
                return false;
            }
            return true;
        });
    }

    // ===== Render List =====
    renderList() {
        this.updateFilterOptions();
        const tbody = document.getElementById('expense-tbody');
        const emptyState = document.getElementById('empty-state');
        const table = document.getElementById('expense-table');
        const filteredTotal = document.getElementById('filtered-total');

        const filtered = this.getFilteredExpenses();
        
        if (filtered.length === 0) {
            table.style.display = 'none';
            emptyState.classList.add('show');
            filteredTotal.textContent = '¥0';
            return;
        }

        table.style.display = 'table';
        emptyState.classList.remove('show');

        // Sort by date (newest first)
        const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = sorted.map(expense => `
            <tr>
                <td>${this.formatDate(expense.date)}</td>
                <td><span class="category-badge">${expense.category}</span></td>
                <td>${expense.vendor || '-'}</td>
                <td class="text-right amount-cell">¥${expense.amount.toLocaleString()}</td>
                <td class="text-center">
                    <button class="delete-btn" onclick="app.deleteExpense(${expense.id})" title="削除">
                        🗑️
                    </button>
                </td>
            </tr>
        `).join('');

        // Calculate total
        const total = filtered.reduce((sum, e) => sum + e.amount, 0);
        filteredTotal.textContent = `¥${total.toLocaleString()}`;
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    // ===== Render Summary =====
    renderSummary() {
        this.renderTotalAmount();
        this.renderMonthlyChart();
        this.renderCategoryList();
    }

    renderTotalAmount() {
        const total = this.expenses.reduce((sum, e) => sum + e.amount, 0);
        document.getElementById('total-amount').textContent = `¥${total.toLocaleString()}`;

        // Update period
        if (this.expenses.length > 0) {
            const dates = this.expenses.map(e => new Date(e.date));
            const minDate = new Date(Math.min(...dates));
            const maxDate = new Date(Math.max(...dates));
            document.getElementById('summary-period').textContent = 
                `${minDate.getFullYear()}年${minDate.getMonth() + 1}月〜${maxDate.getFullYear()}年${maxDate.getMonth() + 1}月`;
        }
    }

    renderMonthlyChart() {
        const container = document.getElementById('monthly-chart');
        
        // Group by month
        const monthlyData = {};
        this.expenses.forEach(e => {
            const date = new Date(e.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyData[key] = (monthlyData[key] || 0) + e.amount;
        });

        const months = Object.keys(monthlyData).sort().slice(-6); // Last 6 months
        const maxAmount = Math.max(...Object.values(monthlyData), 1);

        if (months.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">データがありません</p>';
            return;
        }

        container.innerHTML = months.map(month => {
            const [year, m] = month.split('-');
            const amount = monthlyData[month];
            const percentage = (amount / maxAmount) * 100;
            return `
                <div class="chart-bar">
                    <span class="chart-label">${parseInt(m)}月</span>
                    <div class="chart-bar-container">
                        <div class="chart-bar-fill" style="width: ${Math.max(percentage, 15)}%">
                            <span class="chart-bar-value">¥${amount.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderCategoryList() {
        const container = document.getElementById('category-list');
        
        // Group by category
        const categoryData = {};
        this.expenses.forEach(e => {
            if (e.category) {
                categoryData[e.category] = (categoryData[e.category] || 0) + e.amount;
            }
        });

        const sorted = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);

        if (sorted.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">データがありません</p>';
            return;
        }

        container.innerHTML = sorted.map(([category, amount]) => `
            <div class="category-item">
                <span class="category-name">${category}</span>
                <span class="category-amount">¥${amount.toLocaleString()}</span>
            </div>
        `).join('');
    }

    // ===== Export =====
    initExport() {
        document.getElementById('export-csv-btn').addEventListener('click', () => {
            this.exportCSV();
        });
    }

    exportCSV() {
        if (this.expenses.length === 0) {
            this.showToast('エクスポートするデータがありません', 'error');
            return;
        }

        const headers = ['日付', '経費項目', '店舗・相手先', '金額', 'メモ'];
        const rows = this.expenses
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(e => [
                e.date,
                e.category,
                e.vendor || '',
                e.amount,
                e.memo || ''
            ]);

        // Add BOM for Excel compatibility
        let csvContent = '\uFEFF';
        csvContent += headers.join(',') + '\n';
        csvContent += rows.map(row => 
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `経費一覧_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        this.showToast('CSVをダウンロードしました！', 'success');
    }

    // ===== Toast =====
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.querySelector('.toast-message').textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// Initialize app
const app = new ReceiptManager();
