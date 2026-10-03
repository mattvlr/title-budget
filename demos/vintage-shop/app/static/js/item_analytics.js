(function() {
    if (typeof Chart === 'undefined') return;

    document.querySelectorAll('.item-analytics-root').forEach(function(root) {
        var raw = root.getAttribute('data-item-analytics');
        if (!raw) return;

        var data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return;
        }

        var labels = data.labels || [];
        var inventoryCanvas = root.querySelector('.item-analytics-inventory-chart');
        if (inventoryCanvas) {
            new Chart(inventoryCanvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'line',
                            label: 'Inventory on Hand',
                            data: data.inventory_levels || [],
                            borderColor: '#0d6efd',
                            backgroundColor: 'rgba(13, 110, 253, 0.15)',
                            tension: 0.3,
                            fill: false,
                            yAxisID: 'y',
                        },
                        {
                            label: 'Units Sold',
                            data: data.sold_units || [],
                            backgroundColor: 'rgba(255, 193, 7, 0.75)',
                            borderRadius: 6,
                            yAxisID: 'y1',
                        },
                        {
                            label: 'Units Restocked',
                            data: data.restock_units || [],
                            backgroundColor: 'rgba(25, 135, 84, 0.65)',
                            borderRadius: 6,
                            yAxisID: 'y1',
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            beginAtZero: true,
                            position: 'left',
                            title: { display: true, text: 'Inventory' }
                        },
                        y1: {
                            beginAtZero: true,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: 'Units' }
                        }
                    },
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }

        var categoryCanvas = root.querySelector('.item-analytics-category-chart');
        if (categoryCanvas) {
            new Chart(categoryCanvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Category Avg Sold Price',
                            data: data.category_avg_price || [],
                            borderColor: '#6f42c1',
                            backgroundColor: 'rgba(111, 66, 193, 0.14)',
                            tension: 0.3,
                            spanGaps: true
                        },
                        {
                            label: 'Current Item Price',
                            data: data.benchmark_prices || [],
                            borderColor: '#198754',
                            borderDash: [6, 6],
                            pointRadius: 0,
                            tension: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return '$' + value;
                                }
                            }
                        }
                    },
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    });
})();
